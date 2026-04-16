<h1 align="center"> 💰 WAGER-X</h1>
<p align="center">
  <img src="./assets/wager-x-header.gif" alt="Wager-X Animated Header" width="100%" />
</p>
<img src="https://raw.githubusercontent.com/0xmentor/Wager-X/master/frontend/public/brand/wagerx-logo.png" />

</p>

<p align="center"> <img src="https://img.shields.io/badge/status-active-success?style=for-the-badge" /> <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" /> <img src="https://img.shields.io/badge/node-%3E18-green?style=for-the-badge" /> <img src="https://img.shields.io/badge/realtime-websocket-orange?style=for-the-badge" /> </p> <p align="center"> <b>Fast • Transparent • Extensible Wagering Engine</b> </p>

🧠 Overview  

Wager-X is a real-time wagering and prediction platform designed for modern betting systems, esports markets, crypto predictions, and custom event markets.

It enables users to:  

Join live bets
Settle outcomes automatically
Track winnings in real time

✨ Features  
+ Real-time betting engine (WebSockets)  
+ Multi-market support (sports, crypto, custom events)  
+ Instant settlement system  
+ Wallet / balance integration  
+ Anti-fraud protection layer  
+ Admin dashboard control panel  
+ Modular & scalable architecture  

🔐 Security & Privacy  
AES-grade encryption for sensitive data  
JWT-based authentication  
Signed transaction verification  
Anti-double-spend betting protection  
Rate limiting & abuse detection  

🧱 Architecture  
🛠️ Tech Stack  
Frontend: Next.js / React  
Backend: Node.js / Express  
Database: PostgreSQL / MongoDB  
Realtime: Socket.io  
Auth: JWT  
Infra: Docker (optional)  

📦 Installation  
-git clone https://github.com/your-username/wager-x.git  
-cd wager-x  
-npm install  

🔧 Environment Variables  
PORT=5000  
DATABASE_URL=your_database_url  
JWT_SECRET=your_secret_key  
SOCKET_PORT=6000  

▶️ Run Development  
npm run dev  
🏗️ Build for Production  
npm run build  
npm start  

📁 Project Structure  
wager-x/  
│  
├── backend/  
│   ├── controllers/  
│   ├── services/  
│   ├── routes/  
│   └── models/  
│  
├── frontend/  
│   ├── components/  
│   ├── pages/  
│   └── hooks/  
│  
├── utils/  
├── config/  
└── README.md  

- AI odds prediction engine  
- Mobile app (React Native)  
- Blockchain settlement layer  
- Public API for developers  
  
🌐 API Highlights  
Method	Endpoint	Description  
POST	/api/bet	Create a new bet  
GET	/api/markets	Fetch active markets  
POST	/api/settle	Settle a market  
GET	/api/wallet	Get user balance  

🎯 Live System Flow  
User places bet → Market updates in real-time → Event resolves → Auto settlement → Wallet updated instantly  

🤝 Contributing  
Pull requests are welcome.  
fork repo  
create feature branch  
commit changes  
push branch  
open PR  

📜 License  
MIT License © Wager-X  

⚡ Supporting Wager-X  
Wager-X is open-source and community-driven.  

If you like the project:  
⭐ Star this repo  
💰 Sponsor development  
🤝 Submit pull requests  
📢 Share with others  
