import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LiveTicker } from "./LiveTicker";

describe("LiveTicker", () => {
  it("crawls custom text when the headline is on", () => {
    render(<LiveTicker text="Final at the Parade Ground" enabled />);
    expect(screen.getByLabelText("Final at the Parade Ground")).toBeInTheDocument();
  });

  it("uses a fallback so a notice can run before the first ball", () => {
    render(<LiveTicker text="  " fallback="ODCC LIVE" enabled />);
    expect(screen.getByLabelText("ODCC LIVE")).toBeInTheDocument();
  });

  it("stays off until the director turns it on", () => {
    const { container } = render(<LiveTicker text="Hidden" enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
