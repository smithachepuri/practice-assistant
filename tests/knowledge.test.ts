import { describe, expect, it } from "vitest";

import { Bm25Retriever, chunkDocument, chunkDocuments } from "../src/assistant";
import { tokenize } from "../src/assistant/knowledge/retriever";
import { DOCUMENTS } from "./helpers";

describe("chunkDocument", () => {
  it("creates one chunk per section with a stable id and a readable title", () => {
    const chunks = chunkDocument({
      name: "sample-doc",
      text: "# Sample Doc\n\nIntro line.\n\n## First Part\n\nAlpha.\n\n## Second Part\n\nBeta.\n",
    });

    expect(chunks.map((chunk) => chunk.id)).toEqual([
      "sample-doc#overview",
      "sample-doc#first-part",
      "sample-doc#second-part",
    ]);
    expect(chunks[1]).toMatchObject({ document: "sample-doc", title: "Sample Doc: First Part", text: "Alpha." });
  });

  it("skips sections with no text", () => {
    const chunks = chunkDocument({ name: "d", text: "# D\n\n## Empty\n\n## Full\n\nText.\n" });
    expect(chunks.map((chunk) => chunk.id)).toEqual(["d#full"]);
  });

  it("loads every bundled practice document", () => {
    expect(DOCUMENTS.map((doc) => doc.name)).toEqual([
      "appointment-policies",
      "emergencies",
      "hours-and-location",
      "insurance-and-payment",
      "new-patients",
      "services-and-fees",
    ]);
    expect(chunkDocuments(DOCUMENTS).length).toBeGreaterThan(20);
  });
});

describe("tokenize", () => {
  it("lowercases, drops stopwords and stems", () => {
    expect(tokenize("What are your Cleanings and X-rays?")).toEqual(["clean", "x", "ray"]);
    expect(tokenize("payment payments pay")).toEqual(["pay", "pay", "pay"]);
    expect(tokenize("cancelling cancelled cancel")).toEqual(["cancel", "cancel", "cancel"]);
    expect(tokenize("missed address")).toEqual(["miss", "address"]);
  });
});

describe("Bm25Retriever", () => {
  const retriever = new Bm25Retriever(chunkDocuments(DOCUMENTS));

  it.each([
    ["What time do you open?", "hours-and-location#office-hours"],
    ["Do you accept Northstar Dental insurance?", "insurance-and-payment#insurance-plans-we-accept"],
    ["fee for a missed appointment or late cancellation", "appointment-policies#late-cancellation-and-missed-appointments"],
    ["how much is a cleaning", "services-and-fees#standard-fees"],
    ["can I pay in installments with a payment plan", "insurance-and-payment#payment-plans"],
  ])("ranks the right section first for %j", (query, expectedId) => {
    expect(retriever.search(query)[0]?.chunk.id).toBe(expectedId);
  });

  it("returns every relevant section in the top three when several match", () => {
    // Two sections answer this: what to bring, and bringing an insurance card to a first visit.
    const ids = retriever.search("what should I bring to my first visit").map((hit) => hit.chunk.id);
    expect(ids).toContain("new-patients#what-to-bring");
    expect(ids).toContain("insurance-and-payment#checking-your-coverage");
  });

  it("returns nothing when no term matches", () => {
    expect(retriever.search("quantum chromodynamics")).toEqual([]);
  });

  it("respects the result limit and orders by score", () => {
    const hits = retriever.search("appointment", 2);
    expect(hits).toHaveLength(2);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });
});
