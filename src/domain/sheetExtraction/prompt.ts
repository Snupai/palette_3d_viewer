import type { SheetIssue } from "~/domain/sheetExtraction/validateSheet";

/**
 * Field mapping for every sheet layout seen in production. Naming the exact
 * labels is what keeps a small local model from confusing the product, the
 * carton, the block, and the pallet.
 */
export const SHEET_EXTRACTION_PROMPT = `You read photos of German pallet specification sheets ("Palettenschema", "Palettier-Spezifikation", packing plans).
Return one JSON object. All dimensions in millimetres as plain numbers. German decimals use a comma: "148,0" = 148, "1.200,0" = 1200.

Definitions:
- carton = the shipping carton that is stacked on the pallet (Packstück, Verkaufseinheit VE, Umkarton UK, Versandkarton VK, VPE, Shipper, Karton).
  NEVER use the single product/bottle (EP, EE, Endverbrauchereinheit, Bottle, Basis, Tiegel) as the carton.
  When outer and inner sizes are given, use the OUTER size (Außenmaße, OD, Stellmaße, the line WITHOUT parentheses).
- block = the stacked load without the wooden pallet (Blockmaße). Footprint is roughly the pallet size, e.g. 1162 × 780.
- pallet = the wooden pallet footprint, usually 1200 × 800.
- cartonsPerLayer, layers, cartonsPerPallet = counts of CARTONS (not of products inside them).

Where to find the values by layout:
1. MultiPack / Multiscience and "pester pac automation Palettenschema":
   carton = "Packstückmaße" or the first line of "Abmessung der VE" (ignore "Abmessung der EP" = product, ignore the line in parentheses = inner size).
   block = "Blockmaße". loadSpaceHeightMm = third value of "Palettenstauraum".
   "13 Lagen à 40 Packstücke" means layers 13, cartonsPerLayer 40. Or "Verkaufseinheiten je Lage", "Lagen auf der Palette", "Packstücke/Palette" / "Verkaufseinheiten/Palette".
   The large number on the right side of the drawing is totalHeightMm (with pallet).
2. L'Oréal "Palettier-Spezifikation": table "Logistische Daten".
   carton = row "VERPACKUNGSEINHEIT (VPE)" sub-row "aussen". block length/width = row "Lage"; block height = null.
   totalHeightMm = height in row "Palette (incl. Holzpalette)". cartonsPerLayer = "VPE pro Lage", layers = "Anzahl der Lagen pro Palette", cartonsPerPallet = "VPE pro Palette".
   cartonWeightKg = weight in row VPE.
3. TOPS Engineering: carton = column "Shipper (OD)"; block length/width = column "UnitLoad (Incl. Pal)"; totalHeightMm = its height; block height = null.
   cartonsPerLayer = "Cases per layer", layers = "Layers/load", cartonsPerPallet = "Shipper" row of the UnitLoad column.
4. KAO table: carton = row "VK" column "Stellmaße"; block = row "Pal" column "Innenmaße"; totalHeightMm = row "Pal" Stellmaße height.
   cartonsPerLayer = "Lage ... Stk" number; cartonsPerPallet = the "VK" count in row Pal (e.g. 168); layers = cartonsPerPallet / cartonsPerLayer.
5. Simple flyer ("Karton (Außenmaße)", "Kartons pro Lage", "Lagen", "Karton ... pro Palette", "Palettenhöhe"):
   carton = "Karton (Außenmaße)"; block length/width = the two lengths printed on the drawing (e.g. 1148 mm and 790 mm); block height = "Palettenhöhe".

productNumber = our internal article number, digits-dash-digits like "483-01234", "699-00123", "1329-00009+1", "843-00012-10".
  Find it after "Produkt-Nr.", "Bezeichnung" or "Kunde" (pester pac puts it there), or as a number HANDWRITTEN on the sheet in pen or red/blue marker (e.g. "791-01234" written next to a printed header, or a large red number written across the page).
  Prefer the handwritten number when the printed one is missing or incomplete (e.g. "813-......"). Never use the UK number, the L'Oréal PACKPLAN-NUMMER, Gen-ISIS or SAP codes here. Use "" when there is none.
cartonId = the carton code starting with "UK" (e.g. "UK01748"), otherwise "".
Other fields: productName, unitsPerCarton ("Stück pro Umkarton", "EP/Verkaufseinheit").
sheetType: one of "multipack", "pester", "loreal", "tops", "kao", "flyer", "other".
handwrittenNotes: transcribe handwritten text or corrections other than the product number, otherwise null. Use printed values for the fields; never invent values, use null when absent.`;

export function sheetRetryPrompt(issues: readonly SheetIssue[]): string {
  const problems = issues
    .filter(({ severity }) => severity === "error")
    .map(({ message }) => `- ${message}`)
    .join("\n");
  return `Your previous answer fails these consistency checks:
${problems}
Look at the photo again. Check that the carton is the shipping carton (not the product and not the pallet) and that the block is the whole load. Return the corrected JSON object.`;
}
