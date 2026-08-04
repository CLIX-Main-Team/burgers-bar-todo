// The one query key for the scoped people list (GET /users, #31). Lives in its own module so
// every reader — the roster, each PersonCard's row action, and the invite form that refreshes
// it on send — imports it without a cycle between the list and the cards it renders.
export const USERS_QUERY_KEY = ['users'] as const
