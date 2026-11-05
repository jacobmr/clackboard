import { ownerFor, startSession } from "@/lib/auth";
import { claimScreen, newOwner, redeemLoginCode, updateScreen } from "@/lib/db";
import { failed, limited } from "@/lib/ratelimit";

// The phone sends a code it read off a TV. Two kinds:
//   - a new TV's pairing code: pair it to this phone's account (a new account
//     if the phone has none yet), and sign the phone in;
//   - a paired TV's sign-in code (shown after it boots): sign the phone in to
//     that TV's account.
export async function POST(req: Request) {
  if (limited(req)) return Response.json({ error: "too many attempts, try again later" }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "Screen";

  const account = await redeemLoginCode(code);
  if (account) {
    await startSession(account);
    return Response.json({ signedIn: true });
  }

  const current = await ownerFor(req);
  const owner = current ?? newOwner();
  const screen = await claimScreen(owner, code, name);
  if (!screen) {
    failed(req);
    return Response.json({ error: "no screen is showing that code" }, { status: 404 });
  }
  if (!current) await startSession(owner);

  // Give a new screen something to show straight away.
  const ready = await updateScreen(owner, screen.id, {
    playlist: [
      { kind: "text", text: `{green} HELLO {green}\n${name}`, seconds: 20 },
      { kind: "time", seconds: 20 },
    ],
  });
  return Response.json({ screen: ready });
}
