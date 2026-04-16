import Link from "next/link";

export default function NotFound() {
  return (
    <main className="hero">
      <div className="hero-card" style={{ textAlign: "center" }}>
        <h1>Page Not Found</h1>
        <p>The page you requested does not exist.</p>
        <Link href="/" className="btn btn-primary" style={{ marginTop: 12, display: "inline-block" }}>
          Back to Dashboard
        </Link>
      </div>
    </main>
  );
}
