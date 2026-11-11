import { motion } from 'motion/react'
import type { CSSProperties, MouseEvent } from 'react'
import { BrandMark } from '../components/Icon'
import { EASE_OUT, enter, rowIn, staggerDelay } from '../lib/motion'
import { hashFor } from '../lib/route'

// The hero preview is an illustration, so its figures are fixed (as on the design canvas).
const PREVIEW: Array<[string, string, string, string, string, string]> = [
  ['VFV', 'RRSP · Questrade', '+0.30%', '47,306.00', '19.1%', 'up'],
  ['XEQT', 'TFSA · Wealthsimple', '+0.66%', '41,115.20', '16.6%', 'up'],
  ['XIU', 'Non-reg. · Questrade', '+0.38%', '35,010.00', '14.1%', 'up'],
  ['SHOP', 'TFSA, Non-reg.', '+3.84%', '19,010.40', '7.7%', 'up'],
  ['BCE', 'Non-reg. · Questrade', '−2.36%', '10,230.00', '4.1%', 'dn'],
]
const LINE = 'M0 128 L32 141 L64 137 L96 140 L128 146 L160 131 L192 127 L224 117 L256 104 L288 101 L320 97 L352 82 L384 92 L416 87 L448 84 L480 86 L512 72 L544 70 L576 52 L608 51 L640 58 L672 46 L704 30 L736 40 L768 34 L800 18'

const FEATURES: Array<[string, string]> = [
  ['Consolidated holdings', 'One position list across every institution, with book cost, unrealized P/L and weight.'],
  ['Market map and screener', 'Sector heat map with your holdings outlined. Filter the TSX by cap, yield and valuation.'],
  ['News matched to positions', 'Headlines filtered to the symbols you hold, with each one’s move today.'],
  ['Contribution room', 'TFSA, RRSP and FHSA room tracked across institutions, so you don’t over-contribute.'],
]

const SPECS: Array<[string, string]> = [
  ['Account types', 'TFSA, RRSP, FHSA, RESP, margin, cash'],
  ['Institutions', 'Questrade directly; Wealthsimple and others through SnapTrade'],
  ['Market data', 'TSX, TSXV, NYSE, Nasdaq · delayed quotes'],
  ['Currencies', 'CAD and USD, converted at the spot rate'],
  ['Export', 'CSV for holdings and activity'],
]

const SECURITY: Array<[string, string]> = [
  ['Read-only', 'Connections can read balances and positions. They cannot trade or move money.'],
  ['No stored passwords', 'You sign in with your institution. InvestIQ never sees your credentials.'],
  ['Delete on disconnect', 'Unlinking an account removes its data from InvestIQ.'],
]

/** Entrance for blocks that scroll into view: fade up once, staggered by `i`. */
const inView = (i: number) => ({
  initial: { opacity: 0, y: 8 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-40px' },
  transition: { ...enter, duration: 0.32, delay: staggerDelay(i, 0.06) },
})

const toSection = (id: string) => (e: MouseEvent) => {
  // In-page anchors would replace the router's hash; scroll instead.
  e.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

export function Landing() {
  return (
    <div className="lp">
      <header className="bar">
        <div className="wrap lp-hdr">
          <a href={hashFor('landing')} className="logo"><BrandMark size={24} />InvestIQ</a>
          <nav className="hide-m" style={{ display: 'flex', gap: 28 }}>
            <a href="#features" className="nl" onClick={toSection('features')}>Features</a>
            <a href="#coverage" className="nl" onClick={toSection('coverage')}>Coverage</a>
            <a href="#security" className="nl" onClick={toSection('security')}>Security</a>
          </nav>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 20 }}>
            <a href={hashFor('portfolio')} className="nl">Open app</a>
            <a href={hashFor('connect')} className="btn lg">Get started</a>
          </div>
        </div>
      </header>

      <section className="wrap" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="g12" style={{ alignItems: 'center' }}>
          <div className="s5" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <h1>
              <motion.span {...rowIn(0)} transition={{ ...enter, duration: 0.4 }}>Every account.</motion.span>
              <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enter, duration: 0.4, delay: 0.08 }}>One portfolio.</motion.span>
            </h1>
            <motion.p className="lp-lead" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...enter, delay: 0.16 }}>
              Link your TFSA, RRSP, FHSA and brokerage accounts. See consolidated holdings, real returns, market data and the news that affects what you own.
            </motion.p>
            <motion.div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...enter, delay: 0.22 }}>
              <a href={hashFor('connect')} className="btn lg">Connect an account</a>
              <a href={hashFor('portfolio')} className="btn o lg">View your portfolio</a>
            </motion.div>
            <span className="m" style={{ fontSize: 13 }}>Read-only access</span>
          </div>

          <motion.div className="s7 p" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.1 }}>
            <div className="stats three" style={{ borderBottom: '1px solid var(--line)' }}>
              <div><span className="lab">Market value</span><span className="val">248,312.40</span></div>
              <div><span className="lab">Day change</span><span className="val up">+1,018.42</span></div>
              <div><span className="lab">Unrealized P/L</span><span className="val up">+38,777.96</span></div>
            </div>
            <svg viewBox="0 0 800 160" preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 160, borderBottom: '1px solid var(--line)' }} aria-hidden="true">
              {[40, 80, 120].map((y) => <line key={y} x1="0" x2="800" y1={y} y2={y} stroke="var(--line)" vectorEffect="non-scaling-stroke" />)}
              {/* The line draws in left to right through a mask. */}
              <motion.g initial={{ clipPath: 'inset(0 100% 0 0)' }} animate={{ clipPath: 'inset(0 0% 0 0)' }} transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.3 }}>
                <path d={`${LINE} L800 160 L0 160 Z`} fill="var(--up)" opacity="0.07" />
                <path d={LINE} fill="none" stroke="var(--up)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </motion.g>
            </svg>
            <div className="tb pv" style={{ '--c': '88px minmax(0, 1fr) 76px 108px 84px' } as CSSProperties}>
              <div className="tr th" style={{ gridTemplateColumns: 'var(--c)' }}><span>Symbol</span><span className="L ac">Account</span><span>Day</span><span>Mkt value</span><span className="wt">Weight</span></div>
              {PREVIEW.map(([s, a, d, v, w, cls], i) => (
                <motion.div key={s} className="tr" style={{ gridTemplateColumns: 'var(--c)' }} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enter, delay: 0.4 + staggerDelay(i) }}>
                  <span className="sym">{s}</span><span className="L ac" style={{ color: 'var(--ink2)' }}>{a}</span>
                  <span className={cls}>{d}</span><span>{v}</span><span className="wt">{w}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <section id="features" className="lp-sec">
        <div className="wrap lp-pad" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <h2>What you get</h2>
          <div className="g12" style={{ rowGap: 32 }}>
            {FEATURES.map(([title, text], i) => (
              <motion.div key={title} className="s3 feature" {...inView(i)}>
                <span className="cap">0{i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="coverage" className="lp-sec sub">
        <div className="wrap lp-pad">
          <div className="g12">
            <div className="s4"><h2>Coverage</h2></div>
            <div className="s8" style={{ borderTop: '1px solid var(--line)' }}>
              {SPECS.map(([k, v], i) => (
                <motion.div key={k} className="spec" {...inView(i)}><span className="cap">{k}</span><span>{v}</span></motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="security" className="lp-sec">
        <div className="wrap lp-pad">
          <div className="g12">
            <div className="s4"><h2>Security</h2></div>
            <div className="s8 sec-grid">
              {SECURITY.map(([title, text], i) => (
                <motion.div key={title} className="sec-item" {...inView(i)}><h3>{title}</h3><p>{text}</p></motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="lp-sec" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="wrap" style={{ paddingTop: 48, paddingBottom: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <h2>Link your first account in two minutes.</h2>
          <a href={hashFor('connect')} className="btn lg">Connect an account</a>
        </div>
      </section>

      <footer className="wrap lp-foot">
        <span>© {new Date().getFullYear()} InvestIQ · Not investment advice · Market data may be delayed</span>
        <nav><a href={hashFor('portfolio')} className="nl" style={{ fontSize: 13 }}>Portfolio</a><a href={hashFor('accounts')} className="nl" style={{ fontSize: 13 }}>Accounts</a></nav>
      </footer>
    </div>
  )
}
