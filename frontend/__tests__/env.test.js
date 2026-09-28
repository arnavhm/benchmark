const { parse } = require("../src/live/env");

describe(".env parsing", () => {
  it("lets a real key added below the copied placeholder win", () => {
    const vars = parse("GROQ_API_KEY=your_groq_api_key_here\nGEMINI_API_KEY=\nGROQ_API_KEY=gsk_real123\nGEMINI_API_KEY=AIza_real");
    expect(vars.GROQ_API_KEY).toBe("gsk_real123");
    expect(vars.GEMINI_API_KEY).toBe("AIza_real");
  });
  it("never lets a later placeholder overwrite a real key", () => {
    expect(parse("GROQ_API_KEY=gsk_real\nGROQ_API_KEY=your_groq_api_key_here").GROQ_API_KEY).toBe("gsk_real");
  });
  it("strips quotes, export, spaces, BOM and CRLF", () => {
    const vars = parse('﻿export OPENROUTER_API_KEY = "sk-or-abc"\r\nGEMINI_API_KEY=\'AIza1\'\r\nGROQ_API_KEY=gsk_x # comment\r\n');
    expect(vars).toMatchObject({ OPENROUTER_API_KEY: "sk-or-abc", GEMINI_API_KEY: "AIza1", GROQ_API_KEY: "gsk_x" });
  });
});
