// Built-in product guide. Answers common questions without any LLM, and is
// given to Gemini as grounding context when a key is configured.
const ENTRIES = [
  {
    id: 'roles',
    keywords: ['role', 'roles', 'company', 'buyer', 'recycler', 'admin', 'account', 'who can'],
    answer: 'There are four roles. **Company** (supplier) captures materials, keeps an inventory, publishes listings and answers requests. **Buyer** and **Recycler** search the marketplace and send purchase requests. **Admin** manages users and listings and sees platform-wide impact. Admin accounts cannot self-register.',
  },
  {
    id: 'capture',
    keywords: ['upload', 'photo', 'capture', 'add material', 'new material', 'how do i list', 'start', 'scan'],
    answer: 'Go to **Capture**, upload a site photo, and enter the approximate quantity in kg. The AI suggests material type, condition, an action (Reuse/Sell/Recycle/Dispose), a price range and CO₂ savings. You can correct anything before saving it to your inventory. From **Inventory**, publish it as a marketplace listing.',
  },
  {
    id: 'ai-limits',
    keywords: ['accurate', 'accuracy', 'demo mode', 'heuristic', 'yolo', 'wrong', 'model', 'trust', 'confidence'],
    answer: 'Material recognition uses two trained YOLO models when they are installed: a detector that finds pieces of each material, and a whole-photo classifier as a second opinion. If they are not confident enough, the app asks you to pick the material rather than guessing. Without trained models it runs in **demo mode**: a colour/texture heuristic that is clearly flagged and capped at 65% confidence. Condition scores are always advisory, because photos can hide internal rust or cracks. Inspect physically before high-value trades, and override the AI whenever it is wrong. Overrides are tracked as a classification-accuracy metric.',
  },
  {
    id: 'price',
    keywords: ['price', 'pricing', 'value', 'worth', 'how is price', 'cost', 'quote'],
    answer: 'Prices start from a transparent scrap-index baseline (INR per kg by material). The baseline is scaled by condition, with a small bulk discount and a freight adjustment for distance. Once enough completed trades exist, a regression model trained on them replaces the baseline. You can always set your own price; the share of AI prices accepted without change is tracked.',
  },
  {
    id: 'actions',
    keywords: ['reuse', 'sell', 'recycle', 'dispose', 'recommendation', 'action', 'decide', 'salvage'],
    answer: 'The salvage engine scores four actions. **Reuse** means on your own sites and needs good condition. **Sell** depends on condition, demand, value and distance to buyers. **Recycle** suits poor-condition but recyclable material. **Dispose** is a last resort for damaged, non-recyclable material. All four scores are shown so you can see the reasoning; the final choice is yours.',
  },
  {
    id: 'co2',
    keywords: ['co2', 'carbon', 'emission', 'impact', 'landfill', 'diversion', 'esg', 'environment'],
    answer: 'CO₂ savings are estimates: quantity × an embodied-carbon factor per material. Reuse and sale count 100% of the factor, recycling 45% and disposal 0%. Landfill diversion counts every kg that was reused, sold or recycled. Open **Impact** for totals, diversion rate and median time-to-match.',
  },
  {
    id: 'requests',
    keywords: ['request', 'offer', 'accept', 'reject', 'escrow', 'complete', 'inspection', 'deal', 'trade', 'payment'],
    answer: 'A buyer sends a request on a listing. The company accepts or rejects it, and accepting reserves the listing. The buyer then inspects the material and either **confirms** (trade completed, listing sold, impact counted, optional seller rating) or **cancels** (listing goes back on the market). This two-step check stands in for escrow; no money moves through the platform.',
  },
  {
    id: 'search',
    keywords: ['search', 'find', 'natural language', 'query', 'filter', 'near me', 'match score', 'ranking'],
    answer: 'Type naturally in the marketplace, e.g. "steel under 30k near me in good condition" or "2 tonnes of bricks within 40 km". It is parsed into filters for material, price, distance, quantity and condition. Results are ranked by match score S = 0.4·similarity + 0.25·distance + 0.2·price + 0.15·seller rating.',
  },
  {
    id: 'wanted',
    keywords: ['wanted', 'alert', 'alerts', 'notify', 'notification', 'notifications', 'demand', 'looking for', 'tell me when'],
    answer: 'Buyers and recyclers can post a **Wanted alert** (material, minimum quantity, maximum price per kg, condition and distance). When a supplier publishes a listing that fits, the buyer gets a notification (the bell icon) with a link to it. Suppliers see open requests under **Buyer demand**, and get a nudge when a nearby buyer wants something they already hold in inventory, so they can publish it instead of sending it to landfill.',
  },
  {
    id: 'disputes',
    keywords: ['dispute', 'disputes', 'complaint', 'refund', 'resolver', 'wrong description', 'not as described', 'evidence', 'arbitration'],
    answer: 'If a trade goes wrong (the item is not as described, the price or quality is off, or there is an order problem), the buyer or the seller can **raise a dispute** from **Requests** once the seller has accepted. Both sides add evidence (photos and written statements) and talk in the dispute chat. An admin (the resolver) reviews everything and records one final decision: **approve**, **reject**, **refund** or **resolve**, with a written reason. A refund cancels the trade and puts the listing back on the market; no money moves through the platform. Every step stays in the dispute history, and both sides are notified by the bell icon.',
  },
  {
    id: 'demo',
    keywords: ['demo', 'sample', 'seed', 'fake', 'test data', 'example listings'],
    answer: 'Demo listings are marked **[Demo]**. They are generated examples for testing the interface, not real inventory, market quotes or sales. Add them with `npm run seed:demo` in the backend folder.',
  },
  {
    id: 'assistant',
    keywords: ['what can you do', 'help', 'commands', 'assistant', 'how to use you'],
    answer: 'I can show your inventory or listings ("show my steel inventory"), pending requests, and your impact ("how much CO₂ have we saved?"). I can also estimate a price ("how much is 500 kg of steel in good condition worth?"), recommend an action ("should I recycle old glass?") and search the marketplace ("bricks under 20k near me"). I only read data; publishing, accepting and editing stay on their own pages so you confirm every action.',
  },
];

function findAnswer(message) {
  const text = String(message || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const e of ENTRIES) {
    const score = e.keywords.reduce((s, k) => s + (text.includes(k) ? k.split(' ').length : 0), 0);
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return best;
}

function systemPrompt(role) {
  return [
    'You are the Reclaim Value assistant, a helper inside a circular marketplace for construction and demolition materials in India.',
    `The current user's role is ${role}. Answer briefly (under 120 words), in plain language, using INR and kg.`,
    'You cannot see live inventory, listings or requests and cannot perform actions; tell users which page to use or what to ask the assistant instead (e.g. "show my inventory").',
    'Never invent prices, listings or statistics. Prices and CO2 figures from the platform are estimates; recommend physical inspection before high-value trades.',
    'Product guide:',
    ...ENTRIES.map((e) => `- ${e.answer}`),
  ].join('\n');
}

module.exports = { ENTRIES, findAnswer, systemPrompt };
