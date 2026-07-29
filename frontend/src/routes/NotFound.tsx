import { Link } from "react-router";

import { StumpsMark } from "@/components/layout/Brand";
import { Button } from "@/components/ui/Button";
import { Seam } from "@/components/ui/Surface";

export function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <StumpsMark className="size-10" />
      <p className="font-mono text-sm tracking-[0.2em] text-willow uppercase">Out</p>
      <h1 className="text-2xl">That page isn't here</h1>
      <Seam className="w-32" />
      <p className="text-sm text-willow-soft">
        A scorecard link may have been mistyped, or the match may have been deleted by its
        organiser. Match links look like{" "}
        <code className="font-mono text-chalk">/s/team-name-07</code>.
      </p>
      <Link to="/">
        <Button variant="secondary">Back to the home page</Button>
      </Link>
    </div>
  );
}
