/**
 * Maps Yahoo Finance `assetProfile.industry` → the GICS-style sub-industry labels the app's
 * constituent data already uses, so names enriched from Yahoo merge into the SAME buckets as the
 * well-classified large caps (e.g. Yahoo "Drug Manufacturers - Specialty & Generic" folds into the
 * existing "Pharmaceuticals", not a parallel bucket). Used by scripts/patch-industries.ts to fill the
 * sector-level "Health Care"/"Financials"/… labels the Russell-3000 constituent list leaves on its
 * small-cap tail. Unmapped Yahoo industries fall through to their own (still meaningful) label.
 */
export const YH_INDUSTRY_TO_GICS: Record<string, string> = {
  // ── Health Care ──
  "Biotechnology": "Biotechnology",
  "Drug Manufacturers - General": "Pharmaceuticals",
  "Drug Manufacturers - Specialty & Generic": "Pharmaceuticals",
  "Diagnostics & Research": "Life Sciences Tools & Services",
  "Medical Devices": "Health Care Equipment",
  "Medical Instruments & Supplies": "Health Care Supplies",
  "Medical Care Facilities": "Health Care Facilities",
  "Medical Distribution": "Health Care Distributors",
  "Health Information Services": "Health Care Technology",
  "Healthcare Plans": "Managed Health Care",
  "Pharmaceutical Retailers": "Health Care Services",

  // ── Financials ──
  "Banks - Regional": "Regional Banks",
  "Banks - Diversified": "Diversified Banks",
  "Capital Markets": "Investment Banking & Brokerage",
  "Asset Management": "Asset Management & Custody Banks",
  "Insurance - Life": "Life & Health Insurance",
  "Insurance - Property & Casualty": "Property & Casualty Insurance",
  "Insurance - Diversified": "Multi-line Insurance",
  "Insurance - Reinsurance": "Reinsurance",
  "Insurance - Specialty": "Property & Casualty Insurance",
  "Insurance Brokers": "Insurance Brokers",
  "Credit Services": "Consumer Finance",
  "Financial Data & Stock Exchanges": "Financial Exchanges & Data",
  "Mortgage Finance": "Commercial & Residential Mortgage Finance",
  "Financial Conglomerates": "Diversified Financial Services",
  "Shell Companies": "Specialized Finance",

  // ── Technology ──
  "Software - Application": "Application Software",
  "Software - Infrastructure": "Systems Software",
  "Information Technology Services": "IT Consulting & Other Services",
  "Semiconductors": "Semiconductors",
  "Semiconductor Equipment & Materials": "Semiconductor Materials & Equipment",
  "Computer Hardware": "Technology Hardware, Storage & Peripherals",
  "Consumer Electronics": "Consumer Electronics",
  "Electronic Components": "Electronic Components",
  "Electronics & Computer Distribution": "Technology Distributors",
  "Scientific & Technical Instruments": "Electronic Equipment & Instruments",
  "Communication Equipment": "Communications Equipment",
  "Solar": "Heavy Electrical Equipment",

  // ── Communication Services ──
  "Internet Content & Information": "Interactive Media & Services",
  "Telecom Services": "Integrated Telecommunication Services",
  "Entertainment": "Movies & Entertainment",
  "Electronic Gaming & Multimedia": "Interactive Home Entertainment",
  "Advertising Agencies": "Advertising",
  "Publishing": "Publishing",
  "Broadcasting": "Broadcasting",

  // ── Consumer Cyclical (XLY) ──
  "Internet Retail": "Broadline Retail",
  "Specialty Retail": "Other Specialty Retail",
  "Auto Manufacturers": "Automobile Manufacturers",
  "Auto Parts": "Automotive Parts & Equipment",
  "Auto & Truck Dealerships": "Automotive Retail",
  "Apparel Manufacturing": "Apparel, Accessories & Luxury Goods",
  "Apparel Retail": "Apparel Retail",
  "Footwear & Accessories": "Footwear",
  "Restaurants": "Restaurants",
  "Lodging": "Hotels, Resorts & Cruise Lines",
  "Resorts & Casinos": "Casinos & Gaming",
  "Travel Services": "Hotels, Resorts & Cruise Lines",
  "Gambling": "Casinos & Gaming",
  "Leisure": "Leisure Products",
  "Packaging & Containers": "Metal, Glass & Plastic Containers",
  "Personal Services": "Specialized Consumer Services",
  "Residential Construction": "Homebuilding",
  "Furnishings, Fixtures & Appliances": "Home Furnishings",
  "Home Improvement Retail": "Home Improvement Retail",
  "Department Stores": "Department Stores",
  "Luxury Goods": "Apparel, Accessories & Luxury Goods",
  "Recreational Vehicles": "Leisure Products",
  "Textile Manufacturing": "Apparel, Accessories & Luxury Goods",

  // ── Consumer Defensive (XLP) ──
  "Grocery Stores": "Food Retail",
  "Discount Stores": "Consumer Staples Merchandise Retail",
  "Food Distribution": "Food Distributors",
  "Packaged Foods": "Packaged Foods & Meats",
  "Beverages - Non-Alcoholic": "Soft Drinks & Non-alcoholic Beverages",
  "Beverages - Brewers": "Brewers",
  "Beverages - Wineries & Distilleries": "Distillers & Vintners",
  "Confectioners": "Packaged Foods & Meats",
  "Farm Products": "Agricultural Products & Services",
  "Household & Personal Products": "Household Products",
  "Tobacco": "Tobacco",
  "Education & Training Services": "Education Services",

  // ── Industrials (XLI) ──
  "Aerospace & Defense": "Aerospace & Defense",
  "Airlines": "Passenger Airlines",
  "Railroads": "Rail Transportation",
  "Trucking": "Cargo Ground Transportation",
  "Integrated Freight & Logistics": "Air Freight & Logistics",
  "Marine Shipping": "Marine Transportation",
  "Airports & Air Services": "Airport Services",
  "Building Products & Equipment": "Building Products",
  "Engineering & Construction": "Construction & Engineering",
  "Infrastructure Operations": "Construction & Engineering",
  "Farm & Heavy Construction Machinery": "Construction Machinery & Heavy Transportation Equipment",
  "Industrial Distribution": "Trading Companies & Distributors",
  "Business Equipment & Supplies": "Office Services & Supplies",
  "Conglomerates": "Industrial Conglomerates",
  "Consulting Services": "Research & Consulting Services",
  "Electrical Equipment & Parts": "Electrical Components & Equipment",
  "Specialty Business Services": "Diversified Support Services",
  "Specialty Industrial Machinery": "Industrial Machinery & Supplies & Components",
  "Metal Fabrication": "Industrial Machinery & Supplies & Components",
  "Pollution & Treatment Controls": "Environmental & Facilities Services",
  "Rental & Leasing Services": "Trading Companies & Distributors",
  "Security & Protection Services": "Security & Alarm Services",
  "Staffing & Employment Services": "Human Resource & Employment Services",
  "Tools & Accessories": "Industrial Machinery & Supplies & Components",
  "Waste Management": "Environmental & Facilities Services",

  // ── Energy (XLE) ──
  "Oil & Gas Drilling": "Oil & Gas Drilling",
  "Oil & Gas E&P": "Oil & Gas Exploration & Production",
  "Oil & Gas Integrated": "Integrated Oil & Gas",
  "Oil & Gas Midstream": "Oil & Gas Storage & Transportation",
  "Oil & Gas Refining & Marketing": "Oil & Gas Refining & Marketing",
  "Oil & Gas Equipment & Services": "Oil & Gas Equipment & Services",
  "Thermal Coal": "Coal & Consumable Fuels",
  "Uranium": "Coal & Consumable Fuels",

  // ── Basic Materials (XLB) ──
  "Agricultural Inputs": "Fertilizers & Agricultural Chemicals",
  "Building Materials": "Construction Materials",
  "Chemicals": "Commodity Chemicals",
  "Specialty Chemicals": "Specialty Chemicals",
  "Coking Coal": "Coal & Consumable Fuels",
  "Steel": "Steel",
  "Aluminum": "Aluminum",
  "Copper": "Copper",
  "Other Industrial Metals & Mining": "Diversified Metals & Mining",
  "Gold": "Gold",
  "Silver": "Silver",
  "Other Precious Metals & Mining": "Precious Metals & Minerals",
  "Paper & Paper Products": "Paper Products",
  "Lumber & Wood Production": "Forest Products",

  // ── Real Estate (XLRE) ──
  "REIT - Diversified": "Diversified REITs",
  "REIT - Healthcare Facilities": "Health Care REITs",
  "REIT - Hotel & Motel": "Hotel & Resort REITs",
  "REIT - Industrial": "Industrial REITs",
  "REIT - Mortgage": "Mortgage REITs",
  "REIT - Office": "Office REITs",
  "REIT - Residential": "Multi-Family Residential REITs",
  "REIT - Retail": "Retail REITs",
  "REIT - Specialty": "Other Specialized REITs",
  "Real Estate - Development": "Real Estate Development",
  "Real Estate - Diversified": "Diversified Real Estate Activities",
  "Real Estate Services": "Real Estate Services",

  // ── Utilities (XLU) ──
  "Utilities - Regulated Electric": "Electric Utilities",
  "Utilities - Regulated Gas": "Gas Utilities",
  "Utilities - Regulated Water": "Water Utilities",
  "Utilities - Diversified": "Multi-Utilities",
  "Utilities - Independent Power Producers": "Independent Power Producers & Energy Traders",
  "Utilities - Renewable": "Renewable Electricity",
};

/** Yahoo industry → GICS-style label. Collapses spaced em/en-dashes to " - " first (Yahoo is usually
 *  consistent, but be safe), and falls through to the raw Yahoo label when there's no mapping. */
export function mapYahooIndustry(yahooIndustry: string | null | undefined): string | null {
  if (!yahooIndustry) return null;
  const raw = yahooIndustry.trim();
  if (YH_INDUSTRY_TO_GICS[raw]) return YH_INDUSTRY_TO_GICS[raw];
  const norm = raw.replace(/\s+[—–-]\s+/g, " - "); // only dashes surrounded by spaces (leave Non-Alcoholic)
  return YH_INDUSTRY_TO_GICS[norm] ?? raw;
}
