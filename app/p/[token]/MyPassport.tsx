"use client";

import { useCallback, useEffect, useState } from "react";
import { T } from "@/components/Bi";
import ExerciseView, { sharedDose, sharedName } from "@/components/ExerciseView";
import Figure from "@/components/Figure";
import Icon from "@/components/Icon";
import { dict, fmtDateIn, langs } from "@/lib/i18n";
import { dateKey, daysBetween, fmtTime, parseKey } from "@/lib/logic";
import type { PhonePost, PhoneView } from "@/lib/phone";
import type { Lang } from "@/lib/types";

function savedLang(fallback: Lang): Lang {
  try {
    return (localStorage.getItem("rp-phone:lang") as Lang) || fallback;
  } catch {
    return fallback;
  }
}

// The patient's own view, opened from the QR on the passport cover.
// Ticks and pain scores go straight to the clinic database.
export default function MyPassport({ token }: { token: string }) {
  const [view, setView] = useState<PhoneView | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");
  const [lang, setLang] = useState<Lang>("en");
  const [open, setOpen] = useState<number | null>(null);
  const [today, setToday] = useState("");
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/phone/${token}`, { cache: "no-store" }).catch(() => null);
    if (!res) return setError(true);
    if (!res.ok) return setStatus("missing");
    const v = (await res.json()) as PhoneView;
    setView(v);
    setStatus("ok");
    setToday(dateKey());
    return v;
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch from the clinic server
    load().then((v) => v && setLang(savedLang(v.lang)));
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [load]);

  async function send(body: PhonePost, undo: () => void) {
    const res = await fetch(`/api/phone/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      undo();
      setError(true);
    } else setError(false);
  }

  if (status === "missing") {
    return (
      <main className="patient">
        <div className="patient-card">
          <h1><T lang="both" k="badLink" /></h1>
          <p><T lang="both" k="badLinkBody" /></p>
        </div>
      </main>
    );
  }
  if (!view || !today) {
    return (
      <main className="patient" aria-busy="true">
        <header className="patient-band"><div className="sk sk-band" /></header>
        <div className="patient-card skeleton">
          {error ? <p className="err center"><T lang="both" k="offline" /></p> : null}
          <div className="sk sk-row" />
          <div className="sk sk-row" />
          <div className="sk sk-row" />
        </div>
      </main>
    );
  }

  const v = view;
  const n = v.items.length;
  const l0 = langs(lang)[0];
  const doneOn = (date: string) => v.ticks.filter((t) => t.date === date).length;
  const isDoneToday = (itemId: string) => v.ticks.some((t) => t.itemId === itemId && t.date === today);
  const painToday = v.pain.find((x) => x.date === today)?.score ?? null;

  const elapsed = v.periodDays.filter((d) => d <= today);
  const done = v.ticks.filter((t) => t.date >= v.periodStart && t.date <= today).length;
  const expected = elapsed.length * n;
  const pct = expected ? Math.round((done / expected) * 100) : 0;
  const daysLeft = daysBetween(today, v.visit);
  const time = fmtTime(v.nextVisit);

  function toggle(itemId: string) {
    const was = isDoneToday(itemId);
    const flip = (on: boolean) =>
      setView((cur) =>
        cur && {
          ...cur,
          ticks: on
            ? [...cur.ticks, { itemId, date: today }]
            : cur.ticks.filter((t) => !(t.itemId === itemId && t.date === today)),
        },
      );
    flip(!was);
    send({ type: "tick", itemId, date: today, done: !was }, () => flip(was));
  }

  function setPain(score: number | null) {
    const before = v.pain;
    const next = v.pain.filter((x) => x.date !== today);
    setView({ ...v, pain: score === null ? next : [...next, { date: today, score }] });
    send({ type: "pain", date: today, score }, () => setView((cur) => cur && { ...cur, pain: before }));
  }

  function chooseLang(l: Lang) {
    setLang(l);
    try {
      localStorage.setItem("rp-phone:lang", l);
    } catch {
      // not saved: only this visit uses the choice
    }
  }

  return (
    <main className="patient">
      <header className="patient-band">
        <div className="band-row">
          <small><T lang={lang} k="brand" /> <span className="code">{v.code}</span></small>
          <div className="lang-toggle" role="group" aria-label="Language">
            {(["pa", "both", "en"] as Lang[]).map((l) => (
              <button key={l} type="button" className={l === lang ? "on" : ""} aria-pressed={l === lang} lang={l === "pa" ? "pa" : undefined} onClick={() => chooseLang(l)}>
                {l === "pa" ? "ਪੰਜਾਬੀ" : l === "en" ? "English" : "ਦੋਵੇਂ / Both"}
              </button>
            ))}
          </div>
        </div>
        <h1><T lang={lang} k="today" /></h1>
        <p className="band-date" lang={l0}>{fmtDateIn(parseKey(today), l0, "long")}</p>
      </header>

      <div className="patient-card">
        {error && <p className="err center" role="alert"><T lang={lang} k="offline" /></p>}

        <section className={daysLeft < 0 ? "visit-card overdue" : "visit-card"}>
          <small><T lang={lang} k="nextVisitIn" /></small>
          <strong lang={l0}>
            {fmtDateIn(parseKey(v.visit), l0, "long")}{time && `, ${time}`}
          </strong>
          <span>
            {daysLeft < 0 ? <T lang={lang} k="overdue" /> : daysLeft === 0 ? <T lang={lang} k="visitToday" /> : <>{daysLeft} <T lang={lang} k="daysLeft" /></>}
          </span>
          <div className="period-progress">
            <div className="bar"><div style={{ width: `${pct}%` }} /></div>
            <div className="period-label">
              <small><T lang={lang} k="periodProgress" /></small>
              <strong className="num">{done} / {expected}<span> · {pct}%</span></strong>
            </div>
          </div>
          <div className="period-strip">
            {v.periodDays.map((d) => {
              const c = doneOn(d);
              const cls = d > today ? "dot future" : c >= n ? "dot full" : c > 0 ? "dot part" : "dot";
              return (
                <div key={d} className={d === today ? "week-day now" : "week-day"} title={d}>
                  <span className={d === v.visit ? `${cls} visit` : cls}>{d === v.visit ? <Icon name="calendar" size={14} /> : c >= n && d <= today ? <Icon name="check" size={14} /> : ""}</span>
                  <small lang={l0}>{fmtDateIn(parseKey(d), l0, "short-weekday").slice(0, 3)}</small>
                </div>
              );
            })}
          </div>
        </section>

        {doneOn(today) >= n && <div className="all-done" role="status"><Icon name="check" /><T lang={lang} k="allDone" /></div>}

        <ul className="today-list">
          {v.items.map((ex, i) => {
            const on = isDoneToday(ex.itemId);
            return (
              <li key={ex.itemId} className={on ? "done" : ""}>
                <div className="today-row">
                  {ex.id && <div className="mini-fig"><Figure exerciseId={ex.id} height={84} frame={1} /></div>}
                  <div className="grow today-text">
                    <strong className="ex-title">{sharedName(ex, lang)}</strong>
                    <div className="ex-dose">{sharedDose(ex, lang)}</div>
                  </div>
                </div>
                <div className="today-actions">
                  <button type="button" className={on ? "tick-btn on" : "tick-btn"} onClick={() => toggle(ex.itemId)} aria-pressed={on}>
                    <span className="tick-mark" aria-hidden="true">{on ? <Icon name="check" size={24} /> : null}</span>
                    <span className="tick-label"><T lang={lang} k={on ? "done" : "markDone"} /></span>
                  </button>
                  <button type="button" className="btn steps-btn" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                    <Icon name={open === i ? "close" : "play"} size={18} />
                    <span className="steps-label"><T lang={lang} k={open === i ? "hideSteps" : "showSteps"} /></span>
                  </button>
                </div>
                {open === i && <ExerciseView ex={ex} lang={lang} />}
              </li>
            );
          })}
        </ul>

        <section className="pain-card">
          <h2><T lang={lang} k="painToday" /></h2>
          <div className="pain-buttons" role="group" aria-label={dict(l0).painToday}>
            {Array.from({ length: 11 }, (_, s) => (
              <button
                key={s}
                type="button"
                className={`${painToday === s ? "on" : ""} lvl${s >= 7 ? 3 : s >= 4 ? 2 : 1}`}
                aria-pressed={painToday === s}
                onClick={() => setPain(painToday === s ? null : s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="pain-ends small muted">
            <span><b>0</b> <T lang={lang} k="painNone" /></span>
            <span><b>10</b> <T lang={lang} k="painWorst" /></span>
          </div>
          {painToday !== null && painToday >= 7 && <p className="stop-box" role="alert"><T lang={lang} k="painHigh" /></p>}
        </section>

        {v.phone && (
          <a className="btn block-btn" href={`tel:${v.phone.replace(/[^\d+]/g, "")}`}><Icon name="phone" /><T lang={lang} k="callTherapist" /> <span className="num">{v.phone}</span></a>
        )}

        <div className="stop-box" role="note">
          <strong><Icon name="alert" size={18} /><T lang={lang} k="stopTitle" /></strong>
          <p><T lang={lang} k="stopBody" /></p>
        </div>
        <p className="muted small center">{v.therapist}{v.clinic ? `, ${v.clinic}` : ""}</p>
      </div>
    </main>
  );
}
