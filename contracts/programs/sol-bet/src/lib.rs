use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak::hashv;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("SoLBET1111111111111111111111111111111111111");

const BPS_DENOMINATOR: u64 = 10_000;
const JOIN_WINDOW_SECS: i64 = 300;
const REVEAL_WINDOW_SECS: i64 = 300;
const CLAIM_TIMEOUT_SECS: i64 = 600;
const DEFAULT_FEE_BPS: u16 = 200;

#[program]
pub mod sol_bet {
    use super::*;

    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: u64,
        stake_lamports: u64,
        commit_hash: [u8; 32],
        join_expiry_ts: i64,
    ) -> Result<()> {
        require!(stake_lamports > 0, BetError::InvalidStake);

        let now = Clock::get()?.unix_timestamp;
        require!(join_expiry_ts > now, BetError::InvalidJoinExpiry);
        require!(join_expiry_ts <= now + JOIN_WINDOW_SECS, BetError::InvalidJoinExpiry);

        let game = &mut ctx.accounts.game;
        game.id = game_id;
        game.creator = ctx.accounts.creator.key();
        game.joiner = Pubkey::default();
        game.stake_lamports = stake_lamports;
        game.state = GameState::Waiting;
        game.commit_a = commit_hash;
        game.commit_b = [0; 32];
        game.reveal_a = RevealData::empty();
        game.reveal_b = RevealData::empty();
        game.created_at = now;
        game.joined_at = 0;
        game.reveal_deadline = 0;
        game.join_expiry_ts = join_expiry_ts;
        game.fee_bps = DEFAULT_FEE_BPS;
        game.bump = ctx.bumps.game;
        game.vault_bump = ctx.bumps.vault;

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            stake_lamports,
        )?;

        Ok(())
    }

    pub fn join_game(ctx: Context<JoinGame>, commit_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let game = &mut ctx.accounts.game;

        require!(game.state == GameState::Waiting, BetError::InvalidState);
        require!(game.joiner == Pubkey::default(), BetError::AlreadyJoined);
        require!(now <= game.join_expiry_ts, BetError::JoinExpired);
        require!(ctx.accounts.joiner.key() != game.creator, BetError::SamePlayer);

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.joiner.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            game.stake_lamports,
        )?;

        game.joiner = ctx.accounts.joiner.key();
        game.commit_b = commit_hash;
        game.joined_at = now;
        game.reveal_deadline = now
            .checked_add(REVEAL_WINDOW_SECS)
            .ok_or(BetError::MathOverflow)?;
        game.state = GameState::Joined;

        Ok(())
    }

    pub fn reveal(ctx: Context<Reveal>, chosen_number: u64, salt: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let game = &mut ctx.accounts.game;

        require!(
            game.state == GameState::Joined || game.state == GameState::Reveal,
            BetError::InvalidState
        );
        require!(now <= game.reveal_deadline, BetError::RevealExpired);

        let signer = ctx.accounts.player.key();
        if signer == game.creator {
            require!(!game.reveal_a.revealed, BetError::AlreadyRevealed);
            validate_commit(game.commit_a, chosen_number, salt)?;
            game.reveal_a = RevealData::new(chosen_number, salt);
        } else if signer == game.joiner {
            require!(!game.reveal_b.revealed, BetError::AlreadyRevealed);
            validate_commit(game.commit_b, chosen_number, salt)?;
            game.reveal_b = RevealData::new(chosen_number, salt);
        } else {
            return err!(BetError::UnauthorizedReveal);
        }

        if game.reveal_a.revealed && game.reveal_b.revealed {
            settle_game(
                game,
                &ctx.accounts.treasury.to_account_info(),
                &ctx.accounts.vault.to_account_info(),
                &ctx.accounts.creator.to_account_info(),
                &ctx.accounts.joiner.to_account_info(),
                &ctx.accounts.system_program,
            )?;
            game.state = GameState::Finished;
        } else {
            game.state = GameState::Reveal;
        }

        Ok(())
    }

    pub fn claim_timeout_win(ctx: Context<ClaimTimeoutWin>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let game = &mut ctx.accounts.game;

        require!(
            game.state == GameState::Joined || game.state == GameState::Reveal,
            BetError::InvalidState
        );
        require!(
            now >= game
                .created_at
                .checked_add(CLAIM_TIMEOUT_SECS)
                .ok_or(BetError::MathOverflow)?,
            BetError::TimeoutNotReached
        );

        let claimer = ctx.accounts.claimer.key();
        require!(
            claimer == game.creator || claimer == game.joiner,
            BetError::UnauthorizedClaimer
        );
        let winner = if game.reveal_a.revealed && !game.reveal_b.revealed {
            game.creator
        } else if game.reveal_b.revealed && !game.reveal_a.revealed {
            game.joiner
        } else if !game.reveal_a.revealed && !game.reveal_b.revealed {
            claimer
        } else {
            return err!(BetError::InvalidState);
        };

        let pot = game
            .stake_lamports
            .checked_mul(2)
            .ok_or(BetError::MathOverflow)?;
        pay_winner(
            winner,
            pot,
            game.fee_bps,
            &ctx.accounts.treasury.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            &ctx.accounts.joiner.to_account_info(),
            &ctx.accounts.claimer.to_account_info(),
            &ctx.accounts.system_program,
            game.id,
            game.vault_bump,
        )?;

        game.state = GameState::Finished;
        Ok(())
    }

    pub fn cancel_game(ctx: Context<CancelGame>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let game = &mut ctx.accounts.game;

        require!(game.state == GameState::Waiting, BetError::InvalidState);
        require!(now > game.join_expiry_ts, BetError::JoinNotExpired);

        transfer_from_vault(
            game.id,
            game.vault_bump,
            game.stake_lamports,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            &ctx.accounts.system_program,
        )?;

        game.state = GameState::Cancelled;
        Ok(())
    }
}

fn settle_game<'info>(
    game: &Game,
    treasury: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    creator: &AccountInfo<'info>,
    joiner: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let target = derive_target(game);
    let dist_a = abs_diff(game.reveal_a.chosen_number, target);
    let dist_b = abs_diff(game.reveal_b.chosen_number, target);

    if dist_a == dist_b {
        transfer_from_vault(game.id, game.vault_bump, game.stake_lamports, vault, creator, system_program)?;
        transfer_from_vault(game.id, game.vault_bump, game.stake_lamports, vault, joiner, system_program)?;
        return Ok(());
    }

    let winner = if dist_a < dist_b {
        game.creator
    } else {
        game.joiner
    };
    let pot = game
        .stake_lamports
        .checked_mul(2)
        .ok_or(BetError::MathOverflow)?;

    pay_winner(
        winner,
        pot,
        game.fee_bps,
        treasury,
        vault,
        creator,
        joiner,
        creator,
        system_program,
        game.id,
        game.vault_bump,
    )
}

#[allow(clippy::too_many_arguments)]
fn pay_winner<'info>(
    winner: Pubkey,
    pot: u64,
    fee_bps: u16,
    treasury: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    creator: &AccountInfo<'info>,
    joiner: &AccountInfo<'info>,
    claimer: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    game_id: u64,
    vault_bump: u8,
) -> Result<()> {
    let fee = pot
        .checked_mul(u64::from(fee_bps))
        .ok_or(BetError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(BetError::MathOverflow)?;
    let payout = pot.checked_sub(fee).ok_or(BetError::MathOverflow)?;

    transfer_from_vault(game_id, vault_bump, fee, vault, treasury, system_program)?;

    if winner == *creator.key {
        transfer_from_vault(game_id, vault_bump, payout, vault, creator, system_program)?;
    } else if winner == *joiner.key {
        transfer_from_vault(game_id, vault_bump, payout, vault, joiner, system_program)?;
    } else if winner == *claimer.key {
        transfer_from_vault(game_id, vault_bump, payout, vault, claimer, system_program)?;
    } else {
        return err!(BetError::InvalidWinner);
    }

    Ok(())
}

fn transfer_from_vault<'info>(
    game_id: u64,
    vault_bump: u8,
    amount: u64,
    vault: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let game_id_le = game_id.to_le_bytes();
    let signer_seeds: &[&[u8]] = &[b"vault", game_id_le.as_ref(), &[vault_bump]];

    transfer(
        CpiContext::new_with_signer(
            system_program.to_account_info(),
            Transfer {
                from: vault.clone(),
                to: to.clone(),
            },
            &[signer_seeds],
        ),
        amount,
    )?;

    Ok(())
}

fn validate_commit(commit: [u8; 32], chosen_number: u64, salt: [u8; 32]) -> Result<()> {
    let number_bytes = chosen_number.to_le_bytes();
    let hash = hashv(&[number_bytes.as_ref(), salt.as_ref()]);
    require!(hash.0 == commit, BetError::InvalidCommit);
    Ok(())
}

fn derive_target(game: &Game) -> u64 {
    let id = game.id.to_le_bytes();
    let chosen_a = game.reveal_a.chosen_number.to_le_bytes();
    let chosen_b = game.reveal_b.chosen_number.to_le_bytes();
    let hash = hashv(&[
        id.as_ref(),
        game.reveal_a.salt.as_ref(),
        game.reveal_b.salt.as_ref(),
        chosen_a.as_ref(),
        chosen_b.as_ref(),
    ]);

    let mut first_eight = [0u8; 8];
    first_eight.copy_from_slice(&hash.0[0..8]);
    u64::from_le_bytes(first_eight)
}

fn abs_diff(a: u64, b: u64) -> u64 {
    if a >= b {
        a - b
    } else {
        b - a
    }
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Game::INIT_SPACE,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub game: Account<'info, Game>,
    #[account(
        init,
        payer = creator,
        space = 8,
        seeds = [b"vault", game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [b"treasury"],
        bump
    )]
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub joiner: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"vault", game.id.to_le_bytes().as_ref()],
        bump = game.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Reveal<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut, address = game.creator)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, address = game.joiner)]
    pub joiner: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"vault", game.id.to_le_bytes().as_ref()],
        bump = game.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimTimeoutWin<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut, address = game.creator)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, address = game.joiner)]
    pub joiner: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"vault", game.id.to_le_bytes().as_ref()],
        bump = game.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(mut, address = game.creator)]
    pub creator: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"vault", game.id.to_le_bytes().as_ref()],
        bump = game.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Game {
    pub id: u64,
    pub creator: Pubkey,
    pub joiner: Pubkey,
    pub stake_lamports: u64,
    pub state: GameState,
    pub commit_a: [u8; 32],
    pub commit_b: [u8; 32],
    pub reveal_a: RevealData,
    pub reveal_b: RevealData,
    pub created_at: i64,
    pub joined_at: i64,
    pub reveal_deadline: i64,
    pub join_expiry_ts: i64,
    pub fee_bps: u16,
    pub bump: u8,
    pub vault_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum GameState {
    Waiting,
    Joined,
    Reveal,
    Finished,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct RevealData {
    pub revealed: bool,
    pub chosen_number: u64,
    pub salt: [u8; 32],
}

impl RevealData {
    pub fn empty() -> Self {
        Self {
            revealed: false,
            chosen_number: 0,
            salt: [0; 32],
        }
    }

    pub fn new(chosen_number: u64, salt: [u8; 32]) -> Self {
        Self {
            revealed: true,
            chosen_number,
            salt,
        }
    }
}

#[error_code]
pub enum BetError {
    #[msg("Stake must be greater than 0")]
    InvalidStake,
    #[msg("Join expiry is invalid")]
    InvalidJoinExpiry,
    #[msg("Invalid game state for this action")]
    InvalidState,
    #[msg("Game already joined")]
    AlreadyJoined,
    #[msg("Join window expired")]
    JoinExpired,
    #[msg("Creator cannot join own game")]
    SamePlayer,
    #[msg("Reveal window expired")]
    RevealExpired,
    #[msg("Player already revealed")]
    AlreadyRevealed,
    #[msg("Only game players can reveal")]
    UnauthorizedReveal,
    #[msg("Commit hash did not match reveal")]
    InvalidCommit,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Timeout not reached")]
    TimeoutNotReached,
    #[msg("Invalid winner account")]
    InvalidWinner,
    #[msg("Join window not expired")]
    JoinNotExpired,
    #[msg("Only game participants can claim timeout win")]
    UnauthorizedClaimer,
}
