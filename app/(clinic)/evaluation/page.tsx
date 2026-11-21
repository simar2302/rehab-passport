"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import { adherence, findExercise } from "@/lib/logic";
import { useStore } from "@/lib/store";

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export default function Evaluation() {
  const { data } = useStore();

  // 1. Exercise-log completion, per passport version
  const perPassport = data.passports.map((p) => ({
    p,
    patient: data.patients.find((x) => x.id === p.patientId),
    a: adherence(p, data.logs),
  }));
  const totDone = perPassport.reduce((s, x) => s + x.a.done, 0);
  const totExp = perPassport.reduce((s, x) => s + x.a.expected, 0);

  // Completion by exercise across all passports
  const byExercise = new Map<string, { done: number; expected: number }>();
  for (const { p } of perPassport) {
    for (const it of p.items) {
      const a = adherence({ ...p, items: [it] }, data.logs.filter((l) => l.itemId === it.id));
      const cur = byExercise.get(it.exerciseId) ?? { done: 0, expected: 0 };
      byExercise.set(it.exerciseId, { done: cur.done + a.done, expected: cur.expected + a.expected });
    }
  }

  // 2 + 3. Usability and understanding
  const ease = avg(data.feedback.map((f) => f.ease));
  const understood = data.feedback.length
    ? Math.round((data.feedback.filter((f) => f.understood === "yes").length / data.feedback.length) * 100)
    : null;

  // 4. Clinician time
  const setup = avg(data.passports.filter((p) => p.version === 1).map((p) => p.setupMinutes));
  const update_ = avg(data.passports.filter((p) => p.version > 1).map((p) => p.setupMinutes));
  const review = avg(data.reviews.map((r) => r.minutes));

  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rehab-passport-data.json";
    a.click();
  }

  function exportCsv() {
    const rows = [["patient", "version", "exercise", "date", "source"]];
    for (const l of data.logs) {
      const p = data.passports.find((x) => x.id === l.passportId);
      const it = p?.items.find((i) => i.id === l.itemId);
      const pt = data.patients.find((x) => x.id === p?.patientId);
      rows.push([pt?.code ?? "", String(p?.version ?? ""), it ? findExercise(data, it.exerciseId)?.name ?? "" : "", l.date, l.source]);
    }
    const blob = new Blob([rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "exercise-log.csv";
    a.click();
  }

  const fmt = (n: number | null, d = 1) => (n === null ? "none yet" : n.toFixed(d));

  // Safety monitoring: pain reports per passport (first 3 vs last 3 reports).
  const painRows = data.passports.map((p) => {
    const xs = data.pain.filter((x) => x.passportId === p.id).sort((a, b) => a.date.localeCompare(b.date));
    return {
      p,
      patient: data.patients.find((x) => x.id === p.patientId),
      n: xs.length,
      first: avg(xs.slice(0, 3).map((x) => x.score)),
      last: avg(xs.slice(-3).map((x) => x.score)),
      high: xs.filter((x) => x.score >= 7).length,
      phone: data.logs.filter((l) => l.passportId === p.id && l.source === "phone").length,
      ticks: data.logs.filter((l) => l.passportId === p.id).length,
    };
  });

  const exRows = [...byExercise.entries()]
    .map(([exId, v]) => ({ exId, name: findExercise(data, exId)?.name ?? "", pct: v.expected ? Math.round((v.done / v.expected) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Proposed evaluation</h1>
          <p>Feasibility measures from the concept. <strong>No clinical effectiveness is claimed.</strong></p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn" onClick={exportCsv}><Icon name="download" size={18} />Export log (CSV)</button>
          <button type="button" className="btn" onClick={exportJson}><Icon name="download" size={18} />Export all (JSON)</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><span>Exercise-log completion</span><strong>{totExp ? Math.round((totDone / totExp) * 100) : 0}%</strong><small>{totDone} of {totExp} exercise-days</small></div>
        <div className="stat"><span>Patient usability, 1 to 5</span><strong>{fmt(ease)}</strong><small>{data.feedback.length} responses</small></div>
        <div className="stat"><span>Understood instructions</span><strong>{understood === null ? "None yet" : `${understood}%`}</strong><small>answered yes</small></div>
        <div className="stat"><span>Clinician time</span><strong className="sm">{fmt(setup, 0)} / {fmt(review, 0)} min</strong><small>new passport / review</small></div>
      </div>

      <div className="grid2 top">
        <section className="card flush">
          <div className="card-head"><h2>Completion by passport</h2></div>
          <table className="table">
            <thead><tr><th scope="col">Patient</th><th scope="col">Version</th><th scope="col">Days</th><th scope="col">Completion</th></tr></thead>
            <tbody>
              {perPassport.map(({ p, patient, a }) => (
                <tr key={p.id}>
                  <td><Link href={`/patients/${p.patientId}`} className="strong-link">{patient?.code}</Link></td>
                  <td className="num">v{p.version}</td>
                  <td className="num">{p.items.length ? a.expected / p.items.length : 0}</td>
                  <td className="col-bar">
                    <div className="bar-row">
                      <div className="bar" aria-hidden="true"><div style={{ width: `${a.pct ?? 0}%` }} className={(a.pct ?? 0) < 60 ? "low" : ""} /></div>
                      <span>{a.pct ?? 0}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <div className="card-head"><h2>Completion by exercise</h2><span className="muted small">All passports</span></div>
          <ul className="hbars">
            {exRows.map((r) => (
              <li key={r.exId}>
                <span className="hbar-name">{r.name}</span>
                <span className="bar" aria-hidden="true"><span style={{ width: `${r.pct}%` }} className={r.pct < 60 ? "low" : ""} /></span>
                <span className="num hbar-val">{r.pct}%</span>
              </li>
            ))}
          </ul>
          <p className="muted small note">Average time to update an existing plan: {fmt(update_, 0)} min.</p>
        </section>
      </div>

      <section className="card flush top-gap">
        <div className="card-head">
          <div>
            <h2>Safety monitoring and channel use</h2>
            <p className="muted small">Pain is recorded to spot problems early, not to claim the exercises work.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Patient</th><th scope="col">Version</th><th scope="col">Pain reports</th><th scope="col">Pain, first 3 to last 3</th><th scope="col">Reports of 7+</th><th scope="col">Ticks from phone</th></tr></thead>
            <tbody>
              {painRows.map(({ p, patient, n, first, last, high, phone, ticks }) => (
                <tr key={p.id}>
                  <td><Link href={`/patients/${p.patientId}`} className="strong-link">{patient?.code}</Link></td>
                  <td className="num">v{p.version}</td>
                  <td className="num">{n}</td>
                  <td className="num">{n ? `${fmt(first)} to ${fmt(last)}` : <span className="muted">None yet</span>}</td>
                  <td>{high ? <span className="pill danger">{high}</span> : <span className="num">0</span>}</td>
                  <td className="num">{ticks ? `${Math.round((phone / ticks) * 100)}%` : <span className="muted">None yet</span>} <span className="muted small">({phone}/{ticks})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="muted small note">Clinic details and demo data moved to <Link href="/settings">Clinic settings</Link>.</p>
    </>
  );
}
