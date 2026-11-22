"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import styles from "./Chat.module.css";

interface Source {
  id: string;
  title: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  flags?: string[];
}

const GREETING: Message = {
  role: "assistant",
  content:
    "Hi, I'm the Maple Grove Dental assistant. I can answer questions about the practice and help you book, change or cancel an appointment.",
};

const SUGGESTIONS = [
  "What are your hours?",
  "Do you take Northstar Dental?",
  "I'd like to book a cleaning",
  "What is your cancellation policy?",
];

const NOTICES: Record<string, string> = {
  emergency: "Possible emergency detected. The assistant did not handle this message.",
  injection_blocked: "This message was not passed to the assistant.",
  medical_advice_blocked: "A reply containing medical advice was withheld.",
  unverified_booking_blocked: "A reply claiming an unconfirmed appointment change was withheld.",
};

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Something went wrong. Please try again.");
        return;
      }
      setMessages([
        ...next,
        { role: "assistant", content: String(data.reply ?? ""), sources: data.sources, flags: data.flags },
      ]);
    } catch {
      setError("Could not reach the assistant. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  return (
    <section className={styles.chat} aria-label="Chat with the practice assistant">
      <div className={styles.messages} role="log" aria-live="polite">
        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? styles.rowUser : styles.rowAssistant}>
            <div className={message.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}>
              <p className={styles.text}>{message.content}</p>
              {message.flags?.map((flag) =>
                NOTICES[flag] ? (
                  <p key={flag} className={styles.notice}>
                    {NOTICES[flag]}
                  </p>
                ) : null,
              )}
              {message.sources && message.sources.length > 0 ? (
                <p className={styles.sources}>
                  Based on: {message.sources.map((source) => source.title).join("; ")}
                </p>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className={styles.rowAssistant}>
            <div className={styles.bubbleAssistant}>
              <p className={styles.text}>Thinking…</p>
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {messages.length === 1 ? (
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" className={styles.chip} onClick={() => void send(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <form className={styles.form} onSubmit={onSubmit}>
        <label htmlFor="chat-input" className={styles.srOnly}>
          Your message
        </label>
        <input
          id="chat-input"
          className={styles.input}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type your message"
          maxLength={1500}
          autoComplete="off"
          disabled={busy}
        />
        <button type="submit" className={styles.send} disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
