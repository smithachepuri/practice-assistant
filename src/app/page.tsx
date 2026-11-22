import { Chat } from "@/components/Chat";

export default function HomePage() {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Maple Grove Dental</h1>
        <p>Ask about the practice, or book, change or cancel an appointment.</p>
      </header>
      <Chat />
      <footer className="page-footer">
        Demo for a fictional practice. This assistant does not give medical advice. In an emergency,
        call 911.
      </footer>
    </main>
  );
}
