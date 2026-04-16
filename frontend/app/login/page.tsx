"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type AuthMode = "signin" | "signup";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      if (mode === "signup") {
        const response = await fetch(`${API_BASE}/auth/local/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            username: identifier,
            email,
            password
          })
        });

        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "Sign up failed");
        }

        setSuccess("Account created and signed in.");
        router.push("/");
        return;
      }

      const response = await fetch(`${API_BASE}/auth/local/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          identifier,
          password
        })
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Sign in failed");
      }

      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="glass-container">
        <div className="auth-logo-wrap">
          <Image src="/brand/wagerx-logo.png" alt="Wager X" width={92} height={92} className="auth-logo" />
        </div>

        <h2>{mode === "signin" ? "Sign In" : "Sign Up"}</h2>

        <div className="auth-switch">
          <button
            type="button"
            className={mode === "signin" ? "" : "passive"}
            onClick={() => {
              setMode("signin");
              setError("");
              setSuccess("");
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={mode === "signup" ? "" : "passive"}
            onClick={() => {
              setMode("signup");
              setError("");
              setSuccess("");
            }}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <div className="input-group">
            <label>{mode === "signin" ? "Username or Email" : "Username"}</label>
            <input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
          </div>

          {mode === "signup" && (
            <div className="input-group">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          )}

          <div className="input-group">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? "Please wait..." : mode === "signin" ? "Login" : "Create account"}
          </button>
        </form>

        <small style={{ display: "block", marginTop: 10 }}>
          Google sign-in can be re-enabled with backend token verification if you want a production OAuth flow.
        </small>

        {error && <p className="notice-error">{error}</p>}
        {success && <p className="notice-ok">{success}</p>}

        <div style={{ marginTop: 10 }}>
          <Link href="/" className="inline-link">Back to dashboard</Link>
        </div>
      </div>
    </main>
  );
}
