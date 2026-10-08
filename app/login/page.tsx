import Link from "next/link";
import LoginForm from "@/components/LoginForm";
import { signOut } from "@/lib/auth-actions";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign in, or sign out of the account already signed in.
 *
 * The OTP flow itself lives in components/LoginForm.tsx, untouched -- this file
 * is a server wrapper added only so the page can know whether there is already
 * a session, the same split app/catalog/[slug]/page.tsx makes with
 * components/ProductDetail.tsx.
 *
 * Showing the form to someone already signed in is what made people feel stuck
 * in one account: every signed-in surface either redirected them somewhere or
 * offered no way out, so switching accounts meant waiting for the token to
 * expire. Reaching the sign-in page is the instinct when you want to be someone
 * else, so that is where the way out belongs.
 */

// Reads the session, so there is nothing to prerender. This page was static
// until now; that is the cost of the panel below and it is the whole cost.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const supabase = await createClient();

  // getUser() rather than getSession(), matching every other gate in the app:
  // it is verified with Supabase rather than taken from what the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <LoginForm />;

  return (
    <div className="min-h-screen pt-32 pb-24 flex items-center justify-center bg-ssuni-light1 px-6">
      <div className="w-full max-w-md bg-white border border-ssuni-slate/20 shadow-sm p-10 text-center">
        <h1 className="font-cinzel text-3xl text-ssuni-brown mb-2">SSUNI</h1>
        <p className="font-belleza text-ssuni-slate text-sm mb-8">
          Signed in as <span className="text-ssuni-brown">{user.email}</span>
        </p>

        <form action={signOut}>
          <button
            type="submit"
            className="w-full py-4 font-belleza uppercase tracking-widest text-sm transition-all bg-ssuni-brown text-ssuni-light1 hover:bg-ssuni-slate"
          >
            Sign out
          </button>
        </form>

        <div className="mt-10 border-t border-ssuni-slate/20 pt-6">
          <Link
            href="/catalog"
            className="text-xs font-belleza text-ssuni-slate hover:text-ssuni-brown uppercase tracking-widest transition-colors"
          >
            Return to Store
          </Link>
        </div>
      </div>
    </div>
  );
}
