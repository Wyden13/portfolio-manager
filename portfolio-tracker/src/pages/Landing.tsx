import { motion } from 'motion/react'
import type { MouseEvent, ReactNode } from 'react'
import { BrandMark } from '../components/Icon'
import { EASE_OUT, enter, staggerDelay } from '../lib/motion'
import { hashFor } from '../lib/route'

// The hero preview is an illustration, so its figures are fixed (as on the design canvas).
const PREVIEW: Array<[string, string, string, string, string]> = [
  ['VFV', 'RRSP · Questrade', '+0.30%', '47,306.00', 'up'],
  ['XEQT', 'TFSA · Wealthsimple', '+0.66%', '41,115.20', 'up'],
  ['SHOP', 'TFSA, Non-registered', '+3.84%', '19,010.40', 'up'],
  ['BCE', 'Non-registered · Questrade', '−2.36%', '10,230.00', 'dn'],
]
const LINE = 'M8 122 L40 135 L72 131 L104 134 L136 140 L168 125 L200 121 L232 111 L264 98 L296 95 L328 91 L360 76 L392 86 L424 81 L456 78 L488 80 L520 66 L552 64 L584 46 L616 45 L648 52 L680 40 L712 24 L744 34 L776 28 L792 14'

const FEATURES: Array<[string, ReactNode]> = [
  ['Consolidated holdings', <>One position list across institutions, with <strong>book cost, unrealized P/L and weight</strong>.</>],
  ['Market map and screener', <>A sector heat map with <strong>your holdings outlined</strong>, and a TSX screener.</>],
  ['News on what you own', <>Headlines <strong>matched to your symbols</strong>, with each one’s move today.</>],
  ['Contribution room', <><strong>TFSA, RRSP and FHSA room</strong> tracked across every institution.</>],
]

const SPECS: Array<[string, string]> = [
  ['Account types', 'TFSA, RRSP, FHSA, RESP, margin, cash'],
  ['Institutions', 'Questrade directly; Wealthsimple and others through SnapTrade'],
  ['Market data', 'TSX, TSXV, NYSE, Nasdaq · delayed quotes'],
  ['Currencies', 'CAD and USD, converted at the spot rate'],
  ['Export', 'CSV for holdings and activity'],
]

const SECURITY: Array<[string, string]> = [
  ['Read-only', 'Connections read balances and positions. They can’t trade or move money.'],
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

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { ...enter, duration: 0.4, delay },
})

export function Landing() {
  return (
    <div className="lp">
      <header className="hdr-bar">
        <div className="wrap lp-hdr">
          <a href={hashFor('landing')} className="logo"><BrandMark size={30} />InvestIQ</a>
          <nav className="hide-m" style={{ display: 'flex', gap: 28 }}>
            <a href="#features" className="nl" onClick={toSection('features')}>Features</a>
            <a href="#coverage" className="nl" onClick={toSection('coverage')}>Coverage</a>
            <a href="#security" className="nl" onClick={toSection('security')}>Security</a>
          </nav>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
            <a href={hashFor('portfolio')} className="nl">Open app</a>
            <a href={hashFor('connect')} className="btn">Get started</a>
          </div>
        </div>
      </header>

      <section className="wrap" style={{ paddingTop: 96, paddingBottom: 96 }}>
        <div className="g12" style={{ alignItems: 'center' }}>
          <div className="s6" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <h1>
              <motion.span {...fadeUp(0)}>Every account.</motion.span>
              <motion.span {...fadeUp(0.08)}>One portfolio.</motion.span>
            </h1>
            <motion.p className="lp-lead" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...enter, delay: 0.16 }}>
              Link your TFSA, RRSP, FHSA and brokerage accounts. See <strong>real returns across all of them</strong>, plus the market data and news that move what you own.
            </motion.p>
            <motion.div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...enter, delay: 0.22 }}>
              <a href={hashFor('connect')} className="btn lg">Connect an account</a>
              <a href={hashFor('portfolio')} className="btn o lg">View your portfolio</a>
            </motion.div>
            <span className="m" style={{ fontSize: 14 }}><strong className="m2">Read-only access</strong> · nothing can be traded or moved</span>
          </div>

          <motion.div className="s6 pv" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.1 }}>
            <div style={{ padding: '24px 20px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="m" style={{ fontSize: 13 }}>Total portfolio value</span>
              <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>$248,312.40</span>
              <span style={{ fontSize: 14 }}><span className="b up">+$1,018.42 (+0.41%)</span> <span className="m">Today</span></span>
            </div>
            <svg viewBox="0 0 800 160" preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 150 }} aria-hidden="true">
              <line x1="0" x2="800" y1="122" y2="122" stroke="var(--ink3)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
              {/* The line draws in left to right through a mask. */}
              <motion.g initial={{ clipPath: 'inset(0 100% 0 0)' }} animate={{ clipPath: 'inset(0 0% 0 0)' }} transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.3 }}>
                <path d={LINE} fill="none" stroke="var(--up)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </motion.g>
            </svg>
            <div style={{ marginTop: 12 }}>
              {PREVIEW.map(([s, a, d, v, cls], i) => (
                <motion.div key={s} className="pv-row" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enter, delay: 0.4 + staggerDelay(i) }}>
                  <span className="two"><span className="b">{s}</span><span className="m" style={{ fontSize: 13 }}>{a}</span></span>
                  <span className={cls}>{d}</span><span className="b">{v}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <section id="features" className="wrap lp-sec" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        <h2>What you get</h2>
        <div className="g12" style={{ gap: 16 }}>
          {FEATURES.map(([title, text], i) => (
            <motion.div key={title} className="s3 feat" {...inView(i)}>
              <span className="m" style={{ fontSize: 13, fontWeight: 600 }}>0{i + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="coverage" className="wrap lp-sec">
        <div className="g12">
          <div className="s4"><h2>Coverage</h2></div>
          <div className="s8 specs">
            {SPECS.map(([k, v], i) => (
              <motion.div key={k} className="spec" {...inView(i)}><span className="b">{k}</span><span>{v}</span></motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="security" className="wrap lp-sec">
        <div className="g12">
          <div className="s4"><h2>Security</h2></div>
          <div className="s8 sec-grid">
            {SECURITY.map(([title, text], i) => (
              <motion.div key={title} className="sec-item" {...inView(i)}><h3>{title}</h3><p>{text}</p></motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 64 }}>
        <div className="cta-band">
          <h2>Link your first account in two minutes.</h2>
          <a href={hashFor('connect')} className="btn lg">Connect an account</a>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--line)' }}>
        <div className="wrap lp-foot">
          <span>© {new Date().getFullYear()} InvestIQ · Not investment advice · Market data may be delayed</span>
          <nav><a href={hashFor('portfolio')} className="nl">Portfolio</a><a href={hashFor('accounts')} className="nl">Accounts</a></nav>
        </div>
      </footer>
    </div>
  )
}
