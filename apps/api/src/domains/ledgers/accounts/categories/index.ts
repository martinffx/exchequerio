import { Layer } from "effect";
import { ledgerAccountCategoryRepoLayer } from "./LedgerAccountCategoryRepo";
import { ledgerAccountCategoryServiceLayer } from "./LedgerAccountCategoryService";

export const ledgerAccountCategoryLayer = ledgerAccountCategoryServiceLayer.pipe(
	Layer.provide(ledgerAccountCategoryRepoLayer)
);
export { LedgerAccountCategoryRoutes } from "./LedgerAccountCategoryRoutes";
export type { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";
