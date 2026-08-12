// The account the suite creates during first-run setup and signs in as.
// `kuraki import` seeds a placeholder owner row named "owner" with an empty
// password, and `POST /api/setup` claims that row whatever name is chosen —
// so this name is cosmetic, but keeping it the same as the placeholder makes
// the data directory readable when a failure has to be debugged by hand.
export const OWNER = {
  username: 'owner',
  password: 'e2e-owner-password'
};
