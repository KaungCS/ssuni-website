"use client";

/**
 * A submit button that asks first (#77, reused by #80).
 *
 * Deliberately the whole of the guard. Deleting a Hero Story destroys copy and
 * an image that nothing in the database references, so — unlike a sold Product,
 * which Postgres refuses to delete because an Order Item still points at its
 * Variant — there is no constraint to catch a misclick.
 *
 * It degrades to a plain submit without JavaScript: `confirm()` is the browser's
 * own dialog, and with scripts off the `onClick` never runs and the form posts
 * as it always did. That is the right failure direction — the dashboard keeps
 * working, it just stops double-checking. A modal built out of React state would
 * be a delete button that does nothing instead.
 */
export default function ConfirmSubmitButton({
  message,
  children,
  className,
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
