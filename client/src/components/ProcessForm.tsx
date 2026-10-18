import { useState, type FormEvent } from "react";

const PRESETS = [5, 10, 25, 60];

export function ProcessForm({
  maxNow,
  busy,
  onProcess,
}: {
  maxNow: number | null;
  busy: boolean;
  onProcess: (pages: number) => void;
}) {
  const [pages, setPages] = useState("10");
  const value = Number(pages);
  const valid = Number.isInteger(value) && value > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onProcess(value);
  };

  return (
    <section className="card">
      <header className="card-header">
        <h2>Process a document</h2>
        {maxNow !== null && <span className="muted">You can process up to {maxNow} pages now</span>}
      </header>
      <form className="process" onSubmit={submit}>
        <label>
          Pages
          <input
            type="number"
            min={1}
            step={1}
            value={pages}
            onChange={(e) => setPages(e.target.value)}
          />
        </label>
        <div className="presets">
          {PRESETS.map((n) => (
            <button type="button" key={n} className="chip" onClick={() => setPages(String(n))}>
              {n}
            </button>
          ))}
        </div>
        <button type="submit" className="primary" disabled={!valid || busy}>
          {busy ? "Processing…" : "Process"}
        </button>
      </form>
    </section>
  );
}
