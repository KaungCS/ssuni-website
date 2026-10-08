"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

/**
 * Sign out. Called from `/profile`, `/login` and the Admin Dashboard header.
 *
 * A Server Action rather than a `POST /logout` Route Handler, for two reasons
 * that are not style:
 *
 * 1. **This is the only kind of render that can actually clear the cookie.**
 *    `lib/supabase/server.ts` swallows cookie writes, because a Server
 *    Component is already streaming by the time a query runs (see the comment
 *    there). In a Server Action the write succeeds, so `signOut()` here really
 *    removes the session rather than appearing to.
 * 2. **Server Actions carry Next's built-in origin check.** A bare POST handler
 *    does not, and a logout endpoint without one lets any page on the internet
 *    sign our customers out with a hidden form.
 *
 * No parameters, and deliberately no `?next=`: a Server Action is a public POST
 * endpoint, so a redirect target taken from the form body is an open redirect
 * for anyone who wants one -- the same trap `app/login/page.tsx` guards against
 * on the way in. Everyone lands on `/login`, which is where you want to be if
 * you signed out in order to switch accounts, and one link from the shop.
 */
export async function signOut() {
  const supabase = await createClient();

  // Scope "local": end this browser's session only. A shopper signing out of a
  // shared laptop is not asking to be kicked off their phone.
  await supabase.auth.signOut({ scope: "local" });

  // Without this, the client router cache can still hold a /profile payload
  // rendered with the session we just destroyed, and Back shows it. "layout"
  // takes the whole tree, since the session is read all over it.
  revalidatePath("/", "layout");

  redirect("/login");
}
