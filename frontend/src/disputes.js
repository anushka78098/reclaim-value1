// Labels shared by the dispute pages.
export const CATEGORIES = [
  ['description', 'Item not as described'],
  ['pricing', 'Pricing'],
  ['quality', 'Quality'],
  ['order', 'Order issue'],
  ['other', 'Other'],
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);

export const OUTCOMES = [
  ['approve', 'Approve', 'The claim is upheld. Nothing changes in the trade; the decision is recorded.'],
  ['reject', 'Reject', 'The claim is dismissed. Nothing changes in the trade; the decision is recorded.'],
  ['refund', 'Refund', 'Cancels the trade and puts the listing back on the market. No money moves through the platform.'],
  ['resolve', 'Resolve', 'Both sides have settled it between themselves. Closes the case.'],
];
export const OUTCOME_LABEL = {
  approve: 'Claim approved', reject: 'Claim rejected', refund: 'Refund', resolve: 'Resolved',
};

export const HISTORY_LABEL = {
  raised: 'Dispute raised', evidence: 'Evidence added', review: 'Review', decision: 'Decision', withdrawn: 'Withdrawn',
};

export const partyName = (u) => u?.organization || u?.name || 'Unknown';
