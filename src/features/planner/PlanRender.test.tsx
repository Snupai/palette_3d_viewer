// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseRobText } from "~/lib/robParser";
import { PlanRender } from "./PlanRender";

describe("PlanRender physical sheets", () => {
  it("renders base, intermediate and deck sheets at exact heights and includes deck bounds", () => {
    const data = parseRobText(
      "1200 800 144\n400 300 200\n1\n2\n0 0\n1 0\n1 0\n1\n0 0 0 200 150 0 1 0 0\n",
    );
    data.layers[0]!.interlayerThicknessesMm = [2, 5];
    data.layers[1]!.interlayerThicknessesMm = [4];
    data.trailingInterlayerThicknessesMm = [8];
    data.trailingInterlayerDimensions = { width: 1400, length: 1000 };
    const markup = renderToStaticMarkup(<PlanRender data={data} />);
    expect(
      [
        ...markup.matchAll(
          /data-sheet-z="([^"]+)" data-sheet-thickness="([^"]+)"/g,
        ),
      ].map((m) => [Number(m[1]), Number(m[2])]),
    ).toEqual([
      [144, 2],
      [146, 5],
      [351, 4],
      [555, 8],
    ]);
    const viewBox = /viewBox="([^"]+)"/
      .exec(markup)![1]!
      .split(" ")
      .map(Number);
    expect(viewBox[1]).toBe(-728); // Deck's back corner: -100 - 563, plus 65 margin.
    const withoutDeck = renderToStaticMarkup(
      <PlanRender data={{ ...data, trailingInterlayerThicknessesMm: [] }} />,
    );
    expect(/viewBox="([^"]+)"/.exec(withoutDeck)![1]).not.toBe(
      viewBox.join(" "),
    );
    expect(withoutDeck).not.toContain('data-sheet-z="555"');
  });
});
