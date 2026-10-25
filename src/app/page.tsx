import Link from "next/link";
import Board from "@/components/Board";
import { layout } from "@/lib/board";

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16, display: "grid", gap: 24 }}>
      <Board grid={layout("{yellow} CLACKBOARD {yellow}\nANY SCREEN\nIS A FLAP BOARD", 5, 18)} fit="container" />
      <p>
        Open <Link href="/player">/player</Link> on the TV. It shows a pairing code. Then open{" "}
        <Link href="/app">/app</Link> on your phone and enter the code.
      </p>
    </main>
  );
}
