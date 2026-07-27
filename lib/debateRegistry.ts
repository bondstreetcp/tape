/**
 * THE DECLARED DEBATES. Hand-written on purpose — see the header of lib/debates.ts for why a debate
 * cannot be clustered into existence. This file IS the editorial judgement in the feature; everything
 * downstream of it is arithmetic. Treat it like lib/peerCohorts.ts: edit it in a diff, review the diff.
 *
 * HOW TO ADD ONE, and the two things that actually matter:
 *
 * 1. `role` IS THE LOAD-BEARING FIELD. +1 means "this name does well if the BULL pole is right";
 *    -1 means "this name does well if the BEAR pole is right". Evidence polarity is the source's own
 *    direction TIMES this sign, so a bullish filing at a -1 name lands as BEAR evidence. A roster with
 *    every name at +1 produces a one-sided ledger and is not a debate — it is a theme. If you cannot
 *    name the losers, you have not found the argument yet.
 * 2. `anchorText` is embedded and every candidate is scored against it, so write it as prose ABOUT THE
 *    MECHANISM, not as a list of tickers. Vector search on a ticker list retrieves company boilerplate;
 *    vector search on "power availability constrains data-centre siting" retrieves the actual argument.
 *
 * `anchorPhrases` are literal, lower-cased substring matches and are the escape hatch: they admit
 * genuinely on-thesis news at a company nobody put on the roster. Keep them specific — a phrase like
 * "ai" would admit the entire tape.
 */
import type { Debate } from "./debates";

export const DEBATES: Debate[] = [
  {
    id: "ai-capex-durability",
    question: "Does hyperscaler AI capex keep compounding, or does ROI discipline bite first?",
    bullPole:
      "Compute demand still exceeds supply; capex guides keep rising and the spend converts into revenue at the model and application layer.",
    bearPole:
      "Capex is outrunning monetisation; boards start demanding returns, growth rates decelerate, and the buildout digests for several quarters.",
    anchorText:
      "Whether spending on AI data-centre infrastructure is durable or is outrunning the revenue it generates. The mechanism runs from cloud capital-expenditure guidance through accelerator and networking orders, power and cooling availability at the site level, depreciation schedules lengthening to flatter reported margins, and ultimately whether inference revenue and enterprise adoption grow fast enough to justify the installed base. Bears point to return on invested capital, financing of the buildout with debt, and the risk that capacity is absorbed more slowly than it is added.",
    anchorPhrases: [
      "ai capex",
      "data center capacity",
      "data centre capacity",
      "accelerator demand",
      "compute demand",
      "capital expenditure guidance",
      "gpu supply",
      "inference demand",
    ],
    roster: [
      { ticker: "NVDA", role: 1, why: "Sells the accelerators the buildout consumes; the purest capex-durability expression." },
      { ticker: "AVGO", role: 1, why: "Custom silicon and networking attach to the same racks." },
      { ticker: "VRT", role: 1, why: "Power and thermal management — revenue is a direct function of megawatts deployed." },
      { ticker: "AMD", role: 1, why: "Second-source accelerator; benefits from supply scarcity persisting." },
      // The bear pole is NOT "these companies do badly" — it is that capex DISCIPLINE arrives, which
      // relieves the very FCF pressure the buildout puts on the spenders. Their filings therefore carry
      // the opposite sign, and this is what makes the ledger two-sided out of a bull-skewed corpus.
      { ticker: "MSFT", role: -1, why: "Pays for the buildout; free cash flow recovers if spending is disciplined." },
      { ticker: "GOOGL", role: -1, why: "Same — capex is a use of cash the market rewards it for restraining." },
      { ticker: "AMZN", role: -1, why: "AWS margin expands if the capex cycle moderates." },
      { ticker: "META", role: -1, why: "The clearest case of the market punishing capex and rewarding restraint." },
    ],
    opened: "2026-07-27",
  },
  {
    id: "memory-supercycle",
    question: "Is the memory upcycle a structural AI-driven shortage, or a normal cycle that rolls over?",
    bullPole:
      "HBM and high-density NAND are supply-constrained by AI demand, pricing holds, and the traditional boom-bust cycle is dampened by disciplined capacity.",
    bearPole:
      "Suppliers add capacity into strength as they always have; pricing peaks, inventories build, and margins mean-revert on the usual schedule.",
    anchorText:
      "Whether pricing and supply in DRAM, high-bandwidth memory and NAND flash reflect a structural shortage driven by artificial-intelligence workloads or an ordinary semiconductor cycle approaching its peak. The mechanism runs through wafer capacity additions, bit-supply growth versus bit-demand growth, contract versus spot pricing, customer inventory positions, and whether memory content per server and per device keeps rising fast enough to absorb new supply. The bear case is that capacity discipline never survives a period of high margins.",
    anchorPhrases: ["memory pricing", "dram", "nand", "high-bandwidth memory", "hbm", "bit supply", "wafer capacity", "memory content"],
    roster: [
      { ticker: "MU", role: 1, why: "Most direct listed exposure to DRAM and HBM pricing." },
      { ticker: "WDC", role: 1, why: "NAND and high-capacity drives; levered to the same pricing." },
      { ticker: "STX", role: 1, why: "Nearline drive demand rises with data-centre storage build." },
      // Memory is a COST for whoever buys it, so the buyers carry the opposite sign by construction.
      { ticker: "DELL", role: -1, why: "Memory is bill-of-materials cost; margins improve when pricing rolls over." },
      { ticker: "HPQ", role: -1, why: "PC BOM — the clearest beneficiary of falling memory prices." },
      { ticker: "AAPL", role: -1, why: "Very large memory buyer; input costs fall if the cycle turns." },
    ],
    opened: "2026-07-27",
  },
  {
    id: "glp1-spillover",
    question: "Do GLP-1 drugs durably reshape demand outside pharma, or is the second-order impact overstated?",
    bullPole:
      "Adoption keeps broadening, with measurable knock-on effects on food volumes, medical-device utilisation and obesity-linked procedure rates.",
    bearPole:
      "Discontinuation rates, cost and reimbursement limits keep real-world penetration well below the projections the read-through trades on.",
    anchorText:
      "Whether incretin and GLP-1 receptor agonist therapies produce durable second-order demand shifts beyond the drug manufacturers themselves. The mechanism runs through prescription volumes and persistence, insurance and government reimbursement decisions, supply and compounding constraints, and then into calorie consumption and packaged-food volumes, continuous glucose monitoring and insulin pump utilisation, bariatric and orthopaedic procedure rates, and sleep-apnoea device demand. The bear case rests on discontinuation rates and on reimbursement limiting real-world penetration.",
    anchorPhrases: ["glp-1", "glp1", "incretin", "obesity treatment", "weight-loss drug", "semaglutide", "tirzepatide"],
    roster: [
      { ticker: "LLY", role: 1, why: "Primary manufacturer; the read-through only matters if volumes are real." },
      // If the spillover is real these lose; so they carry -1 — good news at them is evidence AGAINST it.
      { ticker: "DXCM", role: -1, why: "CGM demand is debated: fewer diabetics progressing vs broader monitoring." },
      { ticker: "PODD", role: -1, why: "Insulin pump utilisation faces the same two-sided argument." },
      { ticker: "GIS", role: -1, why: "Packaged food volumes are the classic calorie-reduction short." },
      { ticker: "HSY", role: -1, why: "Confection is the most cited category-at-risk." },
    ],
    opened: "2026-07-27",
  },
  {
    id: "rate-cuts-duration",
    question: "Does the easing cycle actually deliver, or does sticky inflation keep the front end high for longer?",
    bullPole:
      "Disinflation continues, the policy path allows real cuts, and rate-sensitive demand — housing, refinancing, capital-intensive REITs — re-accelerates.",
    bearPole:
      "Inflation stalls above target, cuts are repriced out, and anything financed with a mortgage or a floating-rate balance sheet stays impaired.",
    anchorText:
      "Whether the policy easing cycle is delivered as priced or is repriced away by persistent inflation. The mechanism runs from consumer price and wage data through policy guidance into the mortgage rate, housing affordability and starts, commercial real estate refinancing at higher coupons, bank net interest margins and deposit costs, and the discount rate applied to long-duration cash flows. The bear case is that services inflation proves sticky and that the market has already priced a path the data will not support.",
    // Deliberately NOT "interest rate" / "inflation" / "net interest margin" / "refinanc": the first
    // real-data run showed those admit essentially every bank filing on the tape (19 hits, all bull,
    // all phrase). A phrase must name the MECHANISM, not the vocabulary of an entire sector.
    anchorPhrases: ["mortgage rate", "fed funds", "rate cut", "housing affordability", "policy easing"],
    roster: [
      { ticker: "DHI", role: 1, why: "Homebuilder demand is the cleanest transmission of a lower mortgage rate." },
      { ticker: "LEN", role: 1, why: "Same mechanism; a second read on order rates and incentives." },
      { ticker: "O", role: 1, why: "Long-duration net-lease REIT — refinancing cost and cap rates key off the curve." },
      // Higher-for-longer is good for asset gatherers earning on cash and for asset-sensitive lenders.
      { ticker: "SCHW", role: -1, why: "Earns on client cash; a higher front end is a tailwind, not a headwind." },
      { ticker: "MTB", role: -1, why: "Asset-sensitive regional bank — NIM benefits if cuts are repriced out." },
    ],
    opened: "2026-07-27",
  },
];

export const debateById = (id: string): Debate | undefined => DEBATES.find((d) => d.id === id);
