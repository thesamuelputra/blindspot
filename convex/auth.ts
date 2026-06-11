import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';

// Single-operator console: Password provider only, no OAuth, no public signup UI.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
