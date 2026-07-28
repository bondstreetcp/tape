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
      // Widened 2026-07-27 — the original roster (LLY vs DXCM/PODD/GIS/HSY) had zero reach into every
      // intake feed, so the debate could never fill. These come from the healthcare names that actually
      // appear, and they shift the bull side from "the drug maker" to the PICKS AND SHOVELS, which is
      // both better covered and a cleaner read on whether the volumes are real.
      { ticker: "WST", role: 1, why: "Makes the containment and delivery components for injectables — incretin volume shows up directly in its units." },
      { ticker: "TMO", role: 1, why: "Bioprocessing and fill-finish capacity; incretin manufacturing scale-up is a named demand driver." },
      { ticker: "DHR", role: 1, why: "Same bioprocessing exposure — the arms dealer to the manufacturing ramp." },
      { ticker: "MCK", role: 1, why: "Distribution economics scale with script volume regardless of who wins the branded fight." },
      { ticker: "HCA", role: -1, why: "Bariatric and obesity-linked orthopaedic volumes hold up if real-world penetration disappoints." },
      { ticker: "EW", role: -1, why: "Structural-heart demand is downstream of obesity-linked disease; it is undisturbed if the spillover is overstated." },
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

  // ── Added 2026-07-27. Proposed across six domain lenses, then each roster VERIFIED against the real
  // corpus — data/russell3000/snapshot.json for existence and the filing/campaign/analyst feeds for
  // whether it will actually catch evidence. That check earned its keep: it cut COR (rank 209, outside
  // the analyst scan, and its sign is genuinely ambiguous because manufacturer-direct channels are
  // fulfilled by exactly the specialty logistics book it runs) and KAR (not in the universe at all).
  //
  // It also killed a whole debate. A tariff-incidence proposal had domestic mills +1 and their
  // customers -1, but under the bull pole the customers pay an elevated domestic price and under the
  // bear pole they absorb the duty — they LOSE IN BOTH STATES OF THE WORLD. A roster whose minority
  // side cannot win under either pole is not mis-signed, it is a badly posed question, and no amount
  // of ticker surgery fixes it. Dropped rather than patched.

  // WHY IT IS CONTESTED: I lean toward the squeeze being more manufacturer-incident than the bulls allow: ceilings,
  // reference pricing and import levies are additive, and they arrive alongside the expiries. The strongest case for
  // the other side is quantitative. The gross-to-net gap is enormous and has been widening for a decade, which means
  // the headline list prices policy attacks are not what innovators actually receive — several negotiated maximum
  // prices landed close to prices already being realised, so the accounting hit was far smaller than the political
  // theatre implied. The concessions traded in most-favoured-nation arrangements bought tariff relief and channel
  // access that have their own value. Meanwhile the legislative attack on delinking and rebate transparency is aimed
  // squarely at the intermediary, whose earnings quality depends on retaining a spread that both the manufacturers
  // and the regulators now want removed. If that is right, the manufacturer is the party with an escape route — the
  // direct channel — and the middleman is the one with nowhere to move the margin to.
  {
    id: "drug-pricing-incidence",
    question:
      "Does the drug-pricing squeeze land on the manufacturer's net revenue, or on the intermediaries between the manufacturer and the patient?",
    bullPole:
      "US net prices are already far below list, so negotiated ceilings and reference pricing mostly ratify what manufacturers already receive; the political and commercial energy is aimed at the rebate chain, and direct-to-patient channels let innovators reclaim the spread rather than lose it.",
    bearPole:
      "The squeeze is incident on the innovator: negotiated maximum prices, international reference pricing and tariffs on imported medicines compound into a permanent revenue haircut arriving on top of a heavy patent-expiry schedule, while the channel adapts, keeps its fee and is protected by scale.",
    anchorText:
      "Whether policy pressure on prescription drug prices lands on the manufacturer's net revenue or on the intermediaries that sit between the manufacturer and the patient. The mechanism runs from the gap between list price and net price after rebates, discounts and statutory ceilings, through negotiated maximum prices and international reference pricing that reset realised revenue on the highest-volume products, and into the fee and rebate-retention economics of the pharmacy benefit and distribution channel. A manufacturer can respond by cutting list price, launching a direct-to-patient channel that bypasses the rebate chain, or restricting eligibility for statutorily discounted channels — each of which moves margin between the parties rather than out of the system. The argument is therefore about incidence, not about whether the total is falling: one side holds that a transparent net price destroys the spread the channel earns, the other that ceilings and import levies simply subtract from innovator revenue ahead of a wave of patent expiries.",
    anchorPhrases: ["maximum fair price", "drug price negotiation", "most favored nation", "gross-to-net", "list price reduction", "340b", "pharmaceutical tariff", "direct-to-patient"],
    roster: [
      { ticker: "ABBV", role: 1, why: "Post-Humira, its economics depend entirely on holding net price against rebate-driven formulary pressure from the intermediaries." },
      { ticker: "AMGN", role: 1, why: "Branded biologics plus a biosimilar arm — it sits on both sides of the rebate wall and wins if net price, not list, is what gets defended." },
      { ticker: "BMY", role: 1, why: "One of the first products subjected to a negotiated maximum price sits here, so its guidance is the most direct measurement of the actual haircut." },
      { ticker: "MRK", role: 1, why: "The largest US-listed branded book exposed to both negotiation and a major 2028 expiry — the cleanest test of whether policy actually compresses realised net price." },
      { ticker: "PFE", role: 1, why: "Exposed to negotiated products and to import levies, and running one of the most aggressive direct-to-patient channels — it is the bull pole's own experiment." },
      { ticker: "CI", role: -1, why: "Pharmacy benefit is most of its earnings; a transparent, low net price removes the rebate spread that funds them." },
      { ticker: "CVS", role: -1, why: "Its pharmacy-benefit and retail arms earn on the spread between list and net that the manufacturer is trying to reclaim — the counterparty on the same dollar." },
      { ticker: "MCK", role: -1, why: "Channel economics scale with brand list price and with remaining in a channel that a manufacturer-direct model is built to route around." },
    ],
    opened: "2026-07-27",
  },

  // WHY IT IS CONTESTED: I lean toward mean reversion — the bid cycle is annual, benefits get cut, and payer margin
  // has always recovered eventually. The strongest case against me: the buyer of that view has been wrong every year
  // since 2023, and for structural reasons. The 1960s birth cohort is aging into Medicare in unusual numbers, the
  // deferred-care backlog is being worked down slowly rather than in one burst, and several volume categories are
  // genuinely new rather than pulled forward — pulsed-field ablation, expanded TAVR indications, and elective
  // surgery that becomes viable once a patient loses weight. On the other side, repricing is politically capped in a
  // way an ordinary insurance market is not: CMS rate notices, backlash to supplemental-benefit cuts, and prior-
  // authorisation legislation all limit how much cost a plan can push back onto members. If demography rather than
  // backlog is the driver, there is no year in which the trend simply normalises.
  {
    id: "medical-utilization-reset",
    question:
      "Is the step-up in medical utilisation a permanent reset, or a surge that annual repricing eventually catches?",
    bullPole:
      "Utilisation is structurally higher — an older enrolled population, a worked-through deferred-care backlog and genuinely new procedure categories — so claims cost keeps running ahead of premium and the economics sit durably with whoever delivers the care.",
    bearPole:
      "This is a cost trend a one-year contract cycle fixes: plans reprice bids, cut supplemental benefits, tighten authorisation and shed unprofitable membership, margin recovers, and the volume that funded the provider side moderates with it.",
    anchorText:
      "Whether the step-up in medical utilisation among insured populations is a permanent reset or a surge that repricing eventually catches. The mechanism runs from outpatient surgical volumes, orthopaedic and cardiac procedure rates and inpatient admissions among older members, through the benefit ratio and cost trend a health plan books against premium it has already fixed for the plan year, and into next year's bid pricing, benefit design and the risk-adjustment revenue that funds it. Every dollar of unforecast claims cost is revenue somewhere else: the same procedure that breaks an insurer's cost assumption arrives on a provider's income statement as an admission, an implant and a favourable case mix. The contested part is timing and durability — whether plans can reprice, tighten authorisation and exit unprofitable membership fast enough to restore margin, or whether an older and sicker population makes elevated claims structural and hands the economics to the people delivering care.",
    anchorPhrases: ["medical loss ratio", "medical cost trend", "benefit expense ratio", "medical care ratio", "elevated utilization", "same facility admissions", "surgical volumes", "prior authorization"],
    roster: [
      { ticker: "CYH", role: 1, why: "Levered hospital operator — same-facility volume with the least margin cushion absorbing it." },
      { ticker: "HCA", role: 1, why: "Largest listed hospital operator — admissions and outpatient case volume are the most direct read on whether utilisation stays high." },
      { ticker: "SYK", role: 1, why: "Implants plus hospital capital equipment — levered both to procedure volume and to the hospital margins that volume creates." },
      { ticker: "THC", role: 1, why: "Its ambulatory surgery arm is the purest listed exposure to outpatient procedure growth, the fastest-rising piece of the cost trend." },
      { ticker: "UHS", role: 1, why: "Acute-care plus behavioural — a second, differently-mixed read on the same volume, with less payer-mix overlap." },
      { ticker: "ZBH", role: 1, why: "Knee and hip implants are the archetypal deferred senior procedure; revenue is essentially a procedure count." },
      { ticker: "CNC", role: -1, why: "Medicaid and exchange risk pools — margin returns only if acuity normalises or state rates catch up to it." },
      { ticker: "ELV", role: -1, why: "Commercial plus Medicaid: repricing and acuity mix are the swing factor in its benefit expense ratio." },
      { ticker: "HUM", role: -1, why: "Purest Medicare Advantage payer — margin recovery through the bid cycle IS the bear pole, stated as a P&L." },
      { ticker: "MOH", role: -1, why: "Medicaid and exchange risk pools; its medical care ratio is the line this argument turns on." },
      { ticker: "UNH", role: -1, why: "Largest Medicare Advantage book; its medical care ratio falls if the surge reverts, so good news here is evidence the reset was temporary." },
    ],
    opened: "2026-07-27",
  },

  // WHY IT IS CONTESTED: The tape genuinely supports both readings, because aggregate consumption keeps growing
  // while the bottom half of the distribution is visibly strained — those are compatible facts, not contradictory
  // ones. The strongest case for the bear pole, which I find the less convincing but not the weaker-argued side: the
  // top income quintile is roughly 40% of all consumption, so a K-shaped narrative can be true at the cohort level
  // and irrelevant at the aggregate level, meaning every year of 'the consumer is cracking' calls since 2022 has
  // been wrong on the number that actually matters. Value-format share gain is a two-decade secular story about
  // scale, sourcing and supply-chain cost that predates any of this cycle's stress, and off-price margins sit at
  // records largely because brand inventory is abundant and mid-tier competitors have closed — an industry-structure
  // fact being read as a macro signal. Low-wage cohorts also saw the fastest real wage gains of the post-pandemic
  // period, which is the opposite of what a durable-rationing thesis needs. If that is right, the correct trade is
  // the reverse: buy the full-price operator whose traffic is being written off as structurally impaired.
  {
    id: "consumer-trade-down",
    question:
      "Is the shift to lower price points a durable bifurcation of the consumer, or a late-cycle squeeze that unwinds?",
    bullPole:
      "The low- and middle-income wallet is genuinely rationed; trade-down persists, value and off-price formats take durable share, and full-price discretionary demand and mix keep deteriorating.",
    bearPole:
      "This is an ordinary late-cycle squeeze; goods disinflation and positive real wage growth restore the mid-tier consumer, transactions re-accelerate at full price, and the value-share shift proves to have been structural rather than cyclical all along.",
    anchorText:
      "Whether household spending is bifurcating durably, with lower- and middle-income shoppers moving to cheaper formats and lower price points, or whether the squeeze is a late-cycle episode that unwinds as real wages recover. The mechanism runs from non-discretionary costs — rent, insurance, utilities, food and debt service — crowding out the discretionary share of the wallet, into fewer shopping trips, smaller baskets, substitution toward private label and opening price points, deferral of big-ticket purchases, and eating occasions moving out of restaurants and back into the home. It is read in comparable sales decomposed into transactions versus average ticket, in unit volumes versus price and mix, in the promotional intensity required to hold volume, and in branded inventory that flows out of full-price channels into off-price ones. The counter-mechanism is that share gains by value formats are a long-running structural story about scale, sourcing and convenience that is repeatedly misread as a distress signal, and that transaction counts recover once disinflation and real wage growth reach the low end.",
    anchorPhrases: ["trade down", "trade-down", "trading down", "value-seeking", "lower-income", "discretionary spending", "private label", "store traffic"],
    roster: [
      { ticker: "DG", role: 1, why: "Its comp is the cleanest read on whether squeezed households are moving trips to the lowest price point." },
      { ticker: "DLTR", role: 1, why: "Fixed-price-point discounting; a second read on the same low-end wallet, with multi-price expansion as the tell." },
      { ticker: "KR", role: 1, why: "Food-at-home takes the eating occasion that leaves the restaurant — the same dollar, seen from the other side." },
      { ticker: "ROST", role: 1, why: "The lower-income-skewed off-price read; its comp diverges from full-price apparel precisely when trade-down is real." },
      { ticker: "TJX", role: 1, why: "Off-price captures the shopper who still wants the brand but will no longer pay the full-price ticket." },
      { ticker: "WMT", role: 1, why: "The most-cited trade-down beneficiary, taking share from the squeezed low end AND from trading-down higher-income households." },
      { ticker: "CMG", role: -1, why: "Full-price fast casual; transaction growth here is the single best evidence the mid-tier consumer is not rationing." },
      { ticker: "DRI", role: -1, why: "Casual-dining traffic is the discretionary occasion cut first, so strength here directly refutes the squeeze." },
      { ticker: "HD", role: -1, why: "Big-ticket home improvement is the deferral the bull pole predicts; it recovers if the squeeze is only cyclical." },
      { ticker: "NKE", role: -1, why: "Full-price brand strength is the direct counterparty to off-price share gain — its excess inventory is literally the other side's supply." },
      { ticker: "ULTA", role: -1, why: "Mid-tier discretionary beauty holds up only if the wallet is not being rationed; it is the classic at-risk category." },
      // Widened 2026-07-27 after the board came back EMPTY. The original roster was the intuitive one —
      // DG/DLTR/TJX/ROST/KR against CMG/DRI/ULTA/NKE — and every single name had zero reach into the
      // intake feeds. These were chosen the other way round: from the consumer names that DO appear in
      // the analyst, filing and campaign feeds, keeping only those with a defensible sign.
      // ⚠ TSLA was the highest-reach consumer name available (11) and was REJECTED anyway: its filings
      // are about EVs and autonomy, not household trade-down. High reach with a wrong mechanism just
      // imports noise wearing the debate's costume.
      { ticker: "MCD", role: 1, why: "Value menus and franchised scale make it the classic share-gainer when households trade down from casual dining." },
      { ticker: "ACI", role: 1, why: "Grocery captures the eat-at-home shift that trade-down produces." },
      { ticker: "FIVE", role: 1, why: "Deep-discount price points — the destination trade-down goes TO." },
      { ticker: "WH", role: 1, why: "Economy and midscale lodging gains share when travel budgets compress." },
      { ticker: "ELF", role: 1, why: "Mass-market beauty taking share from prestige is the same trade in cosmetics." },
      { ticker: "PAG", role: -1, why: "Automotive retail is the big-ticket deferral; it recovers if the squeeze is only cyclical." },
      { ticker: "HZO", role: -1, why: "Boats are the purest discretionary big ticket on the tape." },
      { ticker: "HOG", role: -1, why: "Recreational vehicles are financed discretionary spending — the first thing postponed." },
      { ticker: "SAM", role: -1, why: "Premium craft beer loses to value brands when the consumer trades down." },
      { ticker: "COCO", role: -1, why: "Premium-priced beverage; the bear pole is that shoppers keep paying up for it." },
      { ticker: "DECK", role: -1, why: "Premium footwear — full-price sell-through is the read on whether the trade-down is real." },
    ],
    opened: "2026-07-27",
  },

  // WHY IT IS CONTESTED: Both sides can point at the same print, because multi-year agreements mean today's reported
  // retention and remaining-performance-obligation describe pricing negotiated before any of this existed — the
  // repricing, if it comes, is invisible for two to three renewal cycles. I lean toward seats being stickier than
  // the deflation case assumes: budget owners buy per-employee because that is how they plan, no large enterprise
  // has actually swapped a seat line for a usage line, and consumption vendors' growth so far is new AI workload
  // rather than migrated seat spend. The strongest case against me is that the unit gets reset by competition rather
  // than by customer choice: the first vendor that prices an agent below the loaded cost of the worker it replaces
  // forces everyone to follow, the earliest evidence appears in net-new seat adds at annual-term SMB vendors and in
  // support functions where an agent does a whole job rather than assisting a person, and by the time it shows in a
  // seat vendor's reported numbers the contracts have already been signed at the new price.
  {
    id: "seat-pricing-under-agents",
    question:
      "Does agentic AI break per-seat software pricing, or do seats prove sticky enough to carry the upsell?",
    bullPole:
      "Work migrates from licensed users to autonomous software and billing follows the workload: metered-consumption vendors capture the spend while seat-priced renewals flatten and reprice down.",
    bearPole:
      "Seats are contractual, multi-year and the natural unit of enterprise budgeting; automation ships as a per-user entitlement uplift, so incumbents raise ARPU and keep the customer relationship intact.",
    anchorText:
      "Whether software revenue billed per named user survives when the work is performed by autonomous software rather than by employees. The mechanism runs from a task that previously required a licensed seat being completed without one, through flat or shrinking user counts at renewal, into expansion that has to come from price uplift rather than added users, while the same workload reappears as metered queries, storage, compute and tokens at vendors that bill by usage. Whether the industry's revenue base actually shrinks or merely changes unit depends on whether buyers accept per-agent or outcome-linked pricing at parity with the labour being displaced, and on how much of a platform's value was ever the seat rather than the underlying system of record. The opposing case is that enterprise agreements are multi-year and repriced only at renewal, that budget owners think in headcount, and that automation is sold as an entitlement on top of the existing user base rather than instead of it.",
    anchorPhrases: ["seat-based", "per-seat", "seat count", "consumption-based pricing", "usage-based pricing", "outcome-based pricing", "per-agent pricing", "digital labor"],
    roster: [
      { ticker: "DDOG", role: 1, why: "Usage-based observability: every autonomous service is itself billable telemetry, decoupling revenue from customer headcount." },
      { ticker: "MDB", role: 1, why: "Atlas meters compute and storage, so an autonomous application pays by workload however few humans ever touch it." },
      { ticker: "NET", role: 1, why: "Per-request edge and inference billing — machine-to-machine calls meter exactly the way human traffic does." },
      { ticker: "PLTR", role: 1, why: "Sells on consumption and outcome terms and pitches replacing headcount rather than adding seats." },
      { ticker: "SNOW", role: 1, why: "Billed in consumption credits, not users — machine-generated query volume lands straight in revenue with no seat to lose." },
      { ticker: "CRM", role: -1, why: "The archetypal per-seat vendor; whether agents get billed alongside seats or instead of them is settled here first." },
      { ticker: "HUBS", role: -1, why: "SMB seats on annual terms — the price-sensitive end, where a flattening seat count would surface earliest." },
      { ticker: "NOW", role: -1, why: "Sells per-user subscription entitlements; a bookings and cRPO beat is direct evidence the seat still expands." },
      { ticker: "TEAM", role: -1, why: "Per-user cloud pricing across exactly the engineering and support populations automation is aimed at first." },
      { ticker: "WDAY", role: -1, why: "Priced against the customer's employee count — a customer that automates headcount literally shrinks its own subscription base." },
    ],
    opened: "2026-07-27",
  },

  // WHY IT IS CONTESTED: I lean toward the incumbents, so the challenger case deserves the stronger statement:
  // recent conflicts made mass a doctrinal requirement rather than a procurement fashion, appropriators have
  // repeatedly funded munitions and autonomy outside the traditional accounts, and the challengers now hold
  // production awards rather than prototypes — the step that historically separates a defence story from a defence
  // business. Meanwhile the incumbents' own backlog quality is degrading under fixed-price development charges,
  // which is precisely the mechanism by which capital and share move without any budget line ever being cancelled.
  // The other side is that a defence budget is an obligation schedule, not an opinion: a continuing resolution bars
  // new starts, sole-source yards and final assembly lines cannot be stood up elsewhere, and low-unit-cost systems
  // must be sold in enormous quantity to equal one platform program. Serious investors disagree because both facts
  // are true at once — the doctrine has moved and the contracts have not, and nobody knows the lag.
  {
    id: "defence-mass-vs-programs",
    question:
      "Does the marginal defence dollar shift to attritable mass, munitions and software, or do programs of record absorb it as they always have?",
    bullPole:
      "Doctrine has changed and procurement is following it: quantity, autonomy and software-defined command and control take a rising share, challengers convert demonstrations into production contracts, and exquisite platform quantities get cut to pay for it.",
    bearPole:
      "Backlog is contractual and industrial capacity for exquisite platforms cannot be recreated; continuing resolutions freeze new starts, the primes hold the integration franchise, and the challengers stay too small to move the sums involved.",
    anchorText:
      "Whether the marginal defence appropriation keeps flowing to multi-decade programs of record or is reallocated toward attritable mass, munitions and software-defined command and control. The mechanism runs from authorisation and appropriation accounts — procurement versus research, development, test and evaluation — through contract awards and the ratio of new orders to revenue, into backlog duration and the mix of cost-plus versus fixed-price development work. Reallocation surfaces first as program restructurings, quantity reductions and unfunded requirements lists, and only years later as production-line rate changes and supplier tooling decisions. Working against it: a continuing resolution bars new starts, sole-source industrial capacity for large platforms is effectively irreplaceable, and low-unit-cost systems generate revenue far more slowly than the headlines about them suggest. Fixed-price development losses at the incumbents are the pivot, because that is the exact mechanism by which share and capital move.",
    anchorPhrases: ["program of record", "attritable", "collaborative combat aircraft", "loitering munition", "unfunded requirements", "munitions production capacity", "fixed-price development", "counter-uas"],
    roster: [
      { ticker: "AVAV", role: 1, why: "Loitering munitions and small unmanned systems are the literal expression of the quantity-over-exquisite thesis; volume is the evidence." },
      { ticker: "KTOS", role: 1, why: "Attritable jets and low-cost propulsion only become a business if the procurement shift is real rather than a demonstration line item." },
      { ticker: "PLTR", role: 1, why: "The purest software-eats-procurement claim: its government growth is the most cited evidence that dollars move to code rather than airframes." },
      { ticker: "RKLB", role: 1, why: "Responsive space and proliferated architectures are the reallocation applied to the space budget, against traditional large-satellite programs." },
      { ticker: "GD", role: -1, why: "Submarines and combat vehicles are the definition of a multi-decade program of record; it wins if the budget stays where it has been." },
      { ticker: "HII", role: -1, why: "Sole-source shipbuilding is the most program-concentrated name in defence — first to be crowded out if the money genuinely reallocates." },
      { ticker: "LMT", role: -1, why: "The largest concentration of exquisite programs of record; its backlog and rate holding is what the bear pole actually asserts." },
      { ticker: "NOC", role: -1, why: "Long-cycle strategic programs are the clearest case that some capacity simply cannot be substituted by attritable systems." },
    ],
    opened: "2026-07-27",
  },

  // WHY IT IS CONTESTED: Both sides are reading the same delinquency series and disagreeing about which derivative
  // matters — the level, which is elevated, or the rate of change, which has flattened. The strongest case for the
  // bull pole, which I find the less convincing side: the genuinely bad paper was originated in 2022 into a cohort
  // that has now largely rolled through, underwriting was tightened materially through 2023 and 2024, and the newer
  // vintages are performing better than the ones they replaced — so the aggregate stock of delinquency can stay high
  // while the flow of new formation is already improving. Card reserve rates sit near 10-11% against a pre-pandemic
  // norm closer to 7%, which means a large share of the losses being debated is already provisioned and shows up as
  // coverage, not as future earnings damage. And the master variable has not broken: with unemployment near cycle
  // lows, there is no mechanism by which broad-based loss escalation happens, because consumers with jobs mostly
  // pay. The bear pole's real burden is to show migration into near-prime rather than persistence within deep
  // subprime — deep subprime is always distressed, and mistaking its permanent condition for a cycle is the most
  // common way this call goes wrong.
  {
    id: "subprime-credit-cycle",
    question:
      "Have consumer credit losses crested and normalised, or is a genuine subprime credit cycle only in its formation stage?",
    bullPole:
      "Delinquency formation has already peaked; the deterioration was a post-stimulus normalisation confined to a narrow cohort, underwriting tightened two years ago, newer vintages perform, and reserve rates are more than adequate so releases follow.",
    bearPole:
      "Losses are still forming and migrating out of deep subprime into near-prime and auto; recovery values weaken loss given default, reserve builds and charge-offs keep outrunning the provisioned rate, and credit availability tightens into it.",
    anchorText:
      "Whether the deterioration in consumer credit is a completed normalisation off stimulus-era lows or the early formation stage of a genuine downturn. The mechanism starts with new delinquency formation and the roll rates that carry an account from thirty to sixty to ninety days past due, then into charge-offs several months later, with the reserve rate and coverage ratio deciding how much of that loss was already provisioned and how much still reaches earnings. Severity is set on the other side of the trade by recovery: what repossessed collateral fetches through wholesale auction and what charged-off paper sells for in the secondary market, so falling used-vehicle values raise loss given default even when the frequency of default is flat. Lenders respond with tighter underwriting standards, credit-line management and slower originations, which suppresses receivables growth and defers the problem rather than resolving it, while borrowers cut off from unsecured credit turn to pledged-collateral lending. The master variable is employment within the borrower cohort itself, because losses at the low end track job losses among lower-wage workers rather than aggregate payrolls.",
    anchorPhrases: ["charge-off", "charged-off", "delinquen", "credit losses", "subprime", "pawn", "repossess", "underwriting standards"],
    roster: [
      { ticker: "BFH", role: 1, why: "Deepest-subprime card book among listed issuers, so it re-rates hardest if losses have genuinely crested." },
      { ticker: "CACC", role: 1, why: "Deep subprime auto, and the most persistent short target in the group, so bear theses on it arrive dated and explicit." },
      { ticker: "COF", role: 1, why: "Largest listed subprime-tilted card and auto book; its monthly delinquency and charge-off disclosures are the running tape of this argument." },
      { ticker: "OMF", role: 1, why: "Nonprime personal instalment lending with no prime book to cushion it; the purest expression of the borrower cohort in question." },
      { ticker: "SYF", role: 1, why: "Private-label card with a near-prime skew — provision direction and reserve release are this debate stated as an accounting entry." },
      { ticker: "ECPG", role: -1, why: "Same trade from the other end — portfolio purchase pricing improves exactly when issuers write off more than they reserved for." },
      { ticker: "FCFS", role: -1, why: "Pawn demand rises when subprime borrowers lose access to unsecured credit; record pawn volumes are a credit-cycle signal, not a retail one." },
      { ticker: "PRAA", role: -1, why: "Buys charged-off consumer paper: rising charge-offs are its supply, and cheap supply is several years of forward collections." },
    ],
    opened: "2026-07-27",
  },

  // WHY IT IS CONTESTED: The disagreement is real because the same traffic decline supports both readings:
  // publishers and aggregators can show sessions falling while the businesses downstream show bookings and
  // advertiser revenue holding, and nobody can cleanly separate the answer layer from ranking changes, the long
  // shift to apps, and normal seasonality. I lean toward the disintermediation being structural. The strongest case
  // against me is that referral clicks were always a mix, and the ones that evaporated were informational queries
  // that never monetised — the transactional click is worth more now, not less, because the visitor who still
  // arrives has already been qualified upstream. On that reading the destination businesses with apps, repeat users
  // and brand were never search-sourced at the margin anyway; advertising budgets follow measured return rather than
  // page views, so the fastest-growing open-web formats have nothing to do with search referrals at all; and the
  // owner of the answer surface has a direct commercial incentive to keep sending the clicks advertisers pay for,
  // because a link nobody clicks cannot be auctioned.
  {
    id: "answer-engines-vs-open-web",
    question:
      "Do AI answer engines break the referral-traffic economy that funds the open web, or was that traffic never the marginal dollar?",
    bullPole:
      "Queries resolve in place instead of in a click; organic sessions at destination sites decline structurally, and commercial intent plus ad budget consolidate into closed first-party surfaces that never needed a referral.",
    bearPole:
      "The clicks that disappeared were low-intent informational ones; transactional demand arrives through apps, brand and paid channels that were never search-sourced, and open-web inventory keeps its budget because advertisers buy measured outcomes, not page views.",
    anchorText:
      "Whether generative answer surfaces break the referral-traffic economy that pays for the open commercial web. The mechanism runs from a query satisfied in place rather than resolved by a click, through falling organic session volume at destination sites, into fewer ad impressions and fewer qualified leads on pages that were monetised by that traffic, forcing those businesses to buy paid placement or rebuild demand through applications and brand. Against that, budgets concentrate where the inventory, the transaction and the measurement all sit inside one first-party surface, so commercial intent can be monetised without ever sending a visitor anywhere. The argument turns on whether the clicks that vanished were the ones that ever converted, and on how much destination-site demand was search-sourced at the margin rather than direct.",
    anchorPhrases: ["ai overviews", "answer engine", "referral traffic", "zero-click", "generative search", "open internet advertising", "traffic acquisition cost", "retail media"],
    roster: [
      { ticker: "AMZN", role: 1, why: "Product search happens inside a first-party app and retail media monetises that intent with no referral involved." },
      { ticker: "APP", role: 1, why: "In-app ad network sitting entirely outside the web's referral economy; gains share as open-web supply and measurement decay." },
      { ticker: "GOOGL", role: 1, why: "Owns the answer surface — if the query is satisfied in place, the commercial intent and the auction stay inside it instead of leaving with the click." },
      { ticker: "META", role: 1, why: "Closed-loop discovery and conversion in feed; the demand it creates never needed a referral link, and budget leaving the open web lands here." },
      { ticker: "EXPE", role: -1, why: "Large organic and paid search channel; if intent is captured upstream, acquisition cost rises before bookings visibly fall." },
      { ticker: "TRIP", role: -1, why: "Meta-search built on search-sourced sessions — the cleanest test of whether an answer can replace the comparison page." },
      { ticker: "TTD", role: -1, why: "Its entire pitch is the open internet outside the walled gardens — a shrinking open-web audience shrinks the inventory it has to sell." },
      { ticker: "YELP", role: -1, why: "The most directly measurable local-search dependent; holding traffic and advertiser revenue is evidence the funnel is intact." },
      { ticker: "ZG", role: -1, why: "Search-sourced top of funnel feeding a per-lead billing model — fewer sessions mechanically means fewer billable leads." },
    ],
    opened: "2026-07-27",
  },
];

export const debateById = (id: string): Debate | undefined => DEBATES.find((d) => d.id === id);
