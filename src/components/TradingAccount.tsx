import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Loader2, Warehouse, Scale, Upload } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { cn } from "@/lib/utils";
import PageTabs from "@/components/PageTabs";
import type { PageTab } from "@/components/PageTabs";
import type { Range, PlLine } from "./ReportsPanel";
import {
  Tile,
  Panel,
  Proof,
  Empty,
  SubTabs,
  HEAD,
  CELL,
  CELL_LEFT,
  ROW,
  TOTAL,
  TH_R,
  num,
  GAIN,
  LOSS,
  dayLabel,
} from "./ReportsPanel";

const TRADING_TABS: readonly PageTab<"trading" | "pl" | "movements">[] = [
  { id: "trading", label: "Trading account", icon: Warehouse },
  { id: "pl", label: "Profit & loss", icon: Scale },
  { id: "movements", label: "Inventory movements", icon: Warehouse },
];

type MovementRow = {
  key: string;
  at: number;
  kind: "material" | "product";
  name: string;
  code: string;
  direction: "in" | "out";
  qty: number;
  unit: string;
  source: string;
  ref: string;
  rate: number;
  value: number;
};

type ValuationRow = {
  key: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  cost: number;
  price: number;
  value: number;
  basis: "average" | "price" | "costing" | "invoice" | "none";
  bought: number;
  lastCost: number;
};

type StockAnalysis = {
  materials: ValuationRow[];
  products: ValuationRow[];
  materialTotal: number;
  productTotal: number;
  total: number;
  movement: MovementRow[];
  movementInValue: number;
  movementOutValue: number;
  empty: boolean;
};

type TradingData = {
  opening: number;
  closing: number;
  purchases: number;
  totalIncome: number;
  totalExpense: number;
  profit: number;
};

export default function TradingAccount({ range }: { range: Range }) {
  const [tab, setTab] = useState<"trading" | "pl" | "movements">("trading");
  const { format: money } = useWorkspaceCurrency();

  const plData = useQuery(api.reports.profitAndLoss, {
    from: range.from,
    to: range.to,
  });
  const valuation = useQuery(api.reports.accountingValuation, {
    from: range.from,
    to: range.to,
  });
  const stock = useQuery(api.reports.stockAnalysis, {
    from: range.from,
    to: range.to,
  });

  const opening = valuation?.opening ?? 0;
  const closing = valuation?.closing ?? 0;
  const purchases = (plData?.expense ?? []).find(
    (l) => l.code === "5200" || l.name.toLowerCase().includes("purchase"),
  )?.amount ?? 0;
  const totalIncome = plData?.totalIncome ?? 0;
  const totalExpense = plData?.totalExpense ?? 0;
  const cogs =
    opening + purchases - closing;
  const grossProfit = totalIncome - cogs;
  const netProfit = totalIncome - totalExpense;
  const margin =
    totalIncome === 0 ? 0 : (grossProfit / totalIncome) * 100;

  const incomeRows = (plData?.income ?? []).map((l) => ({
    _id: l._id,
    code: l.code,
    name: l.name,
    amount: l.amount,
  }));
  const expenseRows = (plData?.expense ?? []).map((l) => ({
    _id: l._id,
    code: l.code,
    name: l.name,
    amount: l.amount,
  }));

  const materialRows = stock?.materials ?? [];
  const productRows = stock?.products ?? [];


  const movements = stock?.movement ?? [];
  const movementInValue = stock?.movementInValue ?? 0;
  const movementOutValue = stock?.movementOutValue ?? 0;

  const postStock = useMutation(api.accounting.postStockAdjustment);
  const [posting, setPosting] = useState(false);

  /** What the ledger is carrying for this period, if anything. */
  const ledgerOpening = plData?.trading?.openingStock ?? 0;
  const ledgerClosing = plData?.trading?.closingStock ?? 0;
  const inLedger = ledgerOpening !== 0 || ledgerClosing !== 0;
  const ledgerBehind =
    inLedger &&
    (Math.abs(ledgerOpening - opening) > 0.01 ||
      Math.abs(ledgerClosing - closing) > 0.01);

  /**
   * Put the two figures in the books.
   *
   * The statements read the ledger, so until this is posted the stock lives
   * only on this screen: the balance sheet shows no stock on hand and the
   * profit and loss cannot work out a cost of goods sold. Posting again is
   * safe — it replaces the last adjustment rather than adding another.
   */
  const postToLedger = async () => {
    setPosting(true);
    try {
      const res = await postStock({
        from: range.from,
        to: range.to,
        label: range.label,
      });
      toast.success(
        res.posted
          ? `Posted opening stock ${money(res.opening)} and closing stock ${money(res.closing)} to the ledger.`
          : "There is no stock on hand in this period to post.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not post the stock.",
      );
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubTabs
          tabs={TRADING_TABS}
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          label="Costing reports"
        />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {ledgerBehind
              ? "The ledger holds different figures"
              : inLedger
                ? "Opening and closing stock are in the ledger"
                : "Not in the ledger yet"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 gap-1.5 rounded-lg text-xs"
            disabled={posting}
            onClick={() => void postToLedger()}
          >
            {posting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Upload className="size-3" />
            )}
            Post stock to ledger
          </Button>
        </div>
      </div>

      {tab === "trading" && (
        <TradingAccountView
          range={range}
          money={money}
          opening={opening}
          purchases={purchases}
          closing={closing}
          cogs={cogs}
          totalIncome={totalIncome}
          grossProfit={grossProfit}
          margin={margin}
          incomeRows={incomeRows}
          plDataEmpty={plData?.empty ?? true}
        />
      )}

      {tab === "pl" && (
        <ProfitAndLossView
          range={range}
          money={money}
          totalIncome={totalIncome}
          totalExpense={totalExpense}
          profit={netProfit}
          margin={plData?.margin ?? 0}
          incomeRows={incomeRows}
          expenseRows={expenseRows}
          plDataEmpty={plData?.empty ?? true}
        />
      )}

      {tab === "movements" && (
        <InventoryMovementsView
          range={range}
          money={money}
          materialRows={materialRows}
          productRows={productRows}
          materialTotal={stock?.materialTotal ?? 0}
          productTotal={stock?.productTotal ?? 0}
          opening={opening}
          closing={closing}
          movements={movements}
          movementInValue={movementInValue}
          movementOutValue={movementOutValue}
          empty={stock?.empty ?? true}
        />
      )}
    </div>
  );
}

function TradingAccountView({
  range,
  money,
  opening,
  purchases,
  closing,
  cogs,
  totalIncome,
  grossProfit,
  margin,
  incomeRows,
  plDataEmpty,
}: {
  range: Range;
  money: (n: number) => string;
  opening: number;
  purchases: number;
  closing: number;
  cogs: number;
  totalIncome: number;
  grossProfit: number;
  margin: number;
  incomeRows: PlLine[];
  plDataEmpty: boolean;
}) {
  const goodsAvailable = opening + purchases;
  const profitable = grossProfit >= 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Opening stock"
          value={money(opening)}
          hint={`As at ${dayLabel(range.from - 86400000)}`}
          tone="text-sky-600 dark:text-sky-400"
        />
        <Tile
          label="Purchases"
          value={money(purchases)}
          hint="Materials purchased in period"
          tone="text-amber-600 dark:text-amber-400"
        />
        <Tile
          label="Closing stock"
          value={money(closing)}
          hint={`As at ${dayLabel(range.to)}`}
          tone="text-violet-600 dark:text-violet-400"
        />
        <Tile
          label="Cost of goods sold"
          value={money(cogs)}
          hint="Opening + Purchases − Closing"
          tone={cogs === 0 ? "text-muted-foreground" : LOSS}
        />
      </div>

      <Panel
        title="Trading account"
        count={`${range.label} · opening stock + purchases − closing stock = COGS`}
      >
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border/60">
          {/* Opening stock */}
          <tr className={ROW}>
            <td className={CELL_LEFT}>
              <span className="font-medium">Opening stock</span>
              <div className="text-[11px] text-muted-foreground">
                Raw materials + finished goods on hand at period start
              </div>
            </td>
            <td className={cn(CELL, "text-sky-600 dark:text-sky-400")}>
              {money(opening)}
            </td>
          </tr>

          {/* Add: Purchases */}
          <tr className={ROW}>
            <td className={CELL_LEFT}>
              <span className="font-medium">Add: Purchases</span>
              <div className="text-[11px] text-muted-foreground">
                Materials purchased during the period
              </div>
            </td>
            <td className={CELL}>{money(purchases)}</td>
          </tr>

          {/* Goods available for sale */}
          <tr className="bg-muted/40">
            <td className={CELL_LEFT}>
              <span className="text-xs font-semibold">Goods available for sale</span>
            </td>
            <td className={cn(CELL, "text-muted-foreground")}>
              {money(goodsAvailable)}
            </td>
          </tr>

          {/* Less: Closing stock */}
          <tr className={ROW}>
            <td className={CELL_LEFT}>
              <span className="font-medium">Less: Closing stock</span>
              <div className="text-[11px] text-muted-foreground">
                Inventory on hand at period end
              </div>
            </td>
            <td className={cn(CELL, "text-violet-600 dark:text-violet-400")}>
              −{money(closing)}
            </td>
          </tr>

          {/* COGS total */}
          <tr className="bg-rose-50 border-t border-rose-200 dark:bg-rose-950/30 dark:border-rose-800/40">
            <td className={CELL_LEFT}>
              <span className="font-semibold text-rose-700 dark:text-rose-300">
                Cost of Goods Sold
              </span>
              <div className="text-[11px] text-rose-600 dark:text-rose-400">
                Opening stock + Purchases − Closing stock
              </div>
            </td>
            <td className={cn(CELL, "font-semibold text-rose-700 dark:text-rose-300")}>
              {money(cogs)}
            </td>
          </tr>

          <tr className="border-t border-border/60">
            <td />
            <td />
          </tr>

          {/* Sales revenue */}
          <tr className={ROW}>
            <td className={CELL_LEFT}>
              <span className="font-medium">Sales revenue</span>
              <div className="text-[11px] text-muted-foreground">
                {incomeRows.length} income account(s) posted in period
              </div>
            </td>
            <td className={cn(CELL, GAIN)}>{money(totalIncome)}</td>
          </tr>

          {/* Gross profit */}
          <tr className="bg-emerald-50 border-t border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800/40">
            <td className={CELL_LEFT}>
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                GROSS PROFIT
              </span>
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                Sales − Cost of Goods Sold
              </div>
            </td>
            <td className={cn(CELL, "font-semibold text-emerald-700 dark:text-emerald-300")}>
              {money(grossProfit)}
              <span className="ml-2 text-[11px] text-emerald-600 dark:text-emerald-400">
                {margin.toFixed(1)}% margin
              </span>
            </td>
          </tr>
          </tbody>
        </table>
      </Panel>

      <Proof ok={!plDataEmpty}>
        {plDataEmpty ? (
          <>
            Nothing was posted between{" "}
            {dayLabel(range.from)} and {dayLabel(range.to)}. Widen the period, or
            post a journal entry against the income and expense accounts.
          </>
        ) : (
          <>
            COGS = Opening stock {money(opening)} + Purchases {money(purchases)} −
            Closing stock {money(closing)} = {money(cogs)}.
          </>
        )}
      </Proof>
    </div>
  );
}

function ProfitAndLossView({
  range,
  money,
  totalIncome,
  totalExpense,
  profit,
  margin,
  incomeRows,
  expenseRows,
  plDataEmpty,
}: {
  range: Range;
  money: (n: number) => string;
  totalIncome: number;
  totalExpense: number;
  profit: number;
  margin: number;
  incomeRows: PlLine[];
  expenseRows: PlLine[];
  plDataEmpty: boolean;
}) {
  const profitable = profit >= 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Total Income"
          value={money(totalIncome)}
          hint={range.label}
          tone={GAIN}
        />
        <Tile
          label="Cost of Goods Sold"
          value={money(totalExpense)}
          hint="COGS - purchases less closing stock"
          tone={LOSS}
        />
        <Tile
          label="Gross Profit"
          value={money(profit)}
          hint={`GP% · ${margin.toFixed(1)}%`}
          tone={profit < 0 ? LOSS : GAIN}
        />
        <Tile
          label="Net Profit"
          value={money(profit)}
          hint={`Net% · ${margin.toFixed(1)}%`}
          tone={profit < 0 ? LOSS : GAIN}
        />
      </div>

      <Panel title="Profit & Loss" count="Gross profit + other income − expenses">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border/60">
          <tr className={ROW}>
            <td className={CELL_LEFT}>
              <span className="font-medium">Gross Profit brought down</span>
              <div className="text-[11px] text-muted-foreground">
                From the trading account above
              </div>
            </td>
            <td className={cn(CELL, profit < 0 ? LOSS : GAIN)}>
              {money(profit)}
            </td>
          </tr>

          <tr className="bg-muted/40">
            <td className={CELL_LEFT}>
              <span className="text-xs font-semibold">Income to allocate</span>
            </td>
            <td className={cn(CELL, profit < 0 ? LOSS : GAIN)}>
              {money(profit)}
            </td>
          </tr>

          <tr className="border-t border-border/60">
            <td colSpan={2} className={cn(CELL_LEFT, "text-center text-[11px] uppercase tracking-wider text-muted-foreground")}>
              Operating Expenses
            </td>
          </tr>

          {expenseRows.length === 0 ? (
            <tr className="bg-muted/20">
              <td colSpan={2} className="px-3 py-4 text-center text-xs text-muted-foreground">
                No operating expenses posted yet
              </td>
            </tr>
          ) : (
            expenseRows.map((row) => (
              <tr key={row._id} className={ROW}>
                <td className={CELL_LEFT}>
                  <span className="font-mono text-muted-foreground">{row.code}</span>{" "}
                  <span className="font-medium">{row.name}</span>
                </td>
                <td className={cn(CELL, LOSS)}>{money(row.amount)}</td>
              </tr>
            ))
          )}

          <tr className="border-t border-rose-200 dark:border-rose-800/40">
            <td className={CELL_LEFT}>
              <span className="font-medium text-rose-600 dark:text-rose-400">
                Total operating expenses
              </span>
            </td>
            <td className={cn(CELL, "font-medium text-rose-600 dark:text-rose-400")}>
              {money(totalExpense)}
            </td>
          </tr>

          <tr className="border-t border-border/60">
            <td className={CELL_LEFT}>
              <span className="font-semibold">Operating Profit</span>
            </td>
            <td className={cn(CELL, "font-semibold", profit < 0 ? LOSS : GAIN)}>
              {money(profit)}
            </td>
          </tr>
          </tbody>
        </table>
      </Panel>

      <div
        className={cn(
          "rounded-2xl border p-4 text-sm",
          profitable
            ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
            : "border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p
              className={cn(
                "font-semibold",
                profitable ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300",
              )}
            >
              {profitable ? "NET PROFIT FOR THE PERIOD" : "NET LOSS FOR THE PERIOD"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {dayLabel(range.from)} → {dayLabel(range.to)}
            </p>
          </div>
          <div className="text-right">
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                profitable ? GAIN : LOSS,
              )}
            >
              {money(profit)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {Math.abs(margin).toFixed(1)}% of revenue{" "}
              {profitable ? "· profitable" : "· loss-making"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InventoryMovementsView({
  range,
  money,
  materialRows,
  productRows,
  materialTotal,
  productTotal,
  opening,
  closing,
  movements,
  movementInValue,
  movementOutValue,
  empty,
}: {
  range: Range;
  money: (n: number) => string;
  materialRows: ValuationRow[];
  productRows: ValuationRow[];
  materialTotal: number;
  productTotal: number;
  opening: number;
  closing: number;
  movements: MovementRow[];
  movementInValue: number;
  movementOutValue: number;
  empty: boolean;
}) {
  const materialOpenTotal = materialRows.reduce((s, r) => s + r.value, 0);
  const productOpenTotal = productRows.reduce((s, r) => s + r.value, 0);
  const materialCloseTotal = materialTotal;
  const productCloseTotal = productTotal;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Opening stock"
          value={money(opening)}
          hint={`As at ${dayLabel(range.from - 86400000)}`}
          tone="text-sky-600 dark:text-sky-400"
        />
        <Tile
          label="Closing stock"
          value={money(closing)}
          hint={`As at ${dayLabel(range.to)}`}
          tone="text-violet-600 dark:text-violet-400"
        />
        <Tile
          label="Materials in"
          value={money(movementInValue)}
          hint="Value of stock received"
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <Tile
          label="Materials out"
          value={money(movementOutValue)}
          hint="Value of stock issued"
          tone="text-rose-600 dark:text-rose-400"
        />
      </div>

      <Panel
        title="Inventory movements"
        count={`Raw materials & finished goods — opening vs. closing positions`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Opening stock column */}
          <div className="rounded-xl border bg-sky-50/50 p-4 dark:bg-sky-950/20">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                OPENING STOCK
              </span>
              <span className="text-[11px] text-muted-foreground">
                As at {dayLabel(range.from - 86400000)} (day before range start)
              </span>
            </div>

            <div className="space-y-2">
              <div className={cn(CELL_LEFT, "font-medium text-sky-700 dark:text-sky-300 uppercase text-[11px] tracking-wider")}>
                Raw Materials
              </div>
              <div className={cn(CELL, "text-sky-600 dark:text-sky-400 font-medium")}>
                {money(materialOpenTotal)}
              </div>

              <div className={cn(CELL_LEFT, "font-medium text-violet-700 dark:text-violet-300 uppercase text-[11px] tracking-wider mt-2")}>
                Finished Goods
              </div>
              <div className={cn(CELL, "text-violet-600 dark:text-violet-400 font-medium")}>
                {money(productOpenTotal)}
              </div>

              <div className="border-t border-sky-200 dark:border-sky-800/40 mt-2">
                <div className={cn(CELL_LEFT, "font-semibold text-sky-700 dark:text-sky-300")}>
                  TOTAL
                </div>
                <div className={cn(CELL, "font-semibold text-sky-700 dark:text-sky-300")}>
                  {money(opening)}
                </div>
              </div>
            </div>
          </div>

          {/* Closing stock column */}
          <div className="rounded-xl border bg-violet-50/50 p-4 dark:bg-violet-950/20">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                CLOSING STOCK
              </span>
              <span className="text-[11px] text-muted-foreground">
                As at {dayLabel(range.to)} (period end)
              </span>
            </div>

            <div className="space-y-2">
              <div className={cn(CELL_LEFT, "font-medium text-sky-700 dark:text-sky-300 uppercase text-[11px] tracking-wider")}>
                Raw Materials
              </div>
              <div className={cn(CELL, "text-sky-600 dark:text-sky-400 font-medium")}>
                {money(materialCloseTotal)}
              </div>

              <div className={cn(CELL_LEFT, "font-medium text-violet-700 dark:text-violet-300 uppercase text-[11px] tracking-wider mt-2")}>
                Finished Goods
              </div>
              <div className={cn(CELL, "text-violet-600 dark:text-violet-400 font-medium")}>
                {money(productCloseTotal)}
              </div>

              <div className="border-t border-violet-200 dark:border-violet-800/40 mt-2">
                <div className={cn(CELL_LEFT, "font-semibold text-violet-700 dark:text-violet-300")}>
                  TOTAL
                </div>
                <div className={cn(CELL, "font-semibold text-violet-700 dark:text-violet-300")}>
                  {money(closing)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Movements list */}
        {empty ? (
          <Empty>
            No inventory movements recorded in this period.
          </Empty>
        ) : movements.length > 0 ? (
          <div className="border-t border-border/60 p-4">
            <div className="space-y-3">
              <div className={cn(CELL_LEFT, "text-[11px] font-semibold tracking-widest text-muted-foreground uppercase")}>
                Movements during the period
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={HEAD}>
                      <th className={CELL_LEFT}>Date</th>
                      <th className={CELL_LEFT}>Item</th>
                      <th className={CELL_LEFT}>Type</th>
                      <th className={TH_R}>Ref</th>
                      <th className={TH_R}>Direction</th>
                      <th className={TH_R}>Qty</th>
                      <th className={TH_R}>Unit</th>
                      <th className={TH_R}>Rate</th>
                      <th className={TH_R}>Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {movements.map((m) => (
                      <tr key={m.key} className={ROW}>
                        <td className={CELL_LEFT}>{dayLabel(m.at)}</td>
                        <td className={CELL_LEFT}>
                          <span className="font-medium">{m.name}</span>
                          <span className="ml-1 text-muted-foreground font-mono text-[11px]">
                            {m.code}
                          </span>
                        </td>
                        <td className={cn(CELL_LEFT, "capitalize")}>
                          {m.kind}
                        </td>
                        <td className={CELL}>{m.ref || "—"}</td>
                        <td className={cn(CELL, m.direction === "in" ? GAIN : LOSS)}>
                          {m.direction === "in" ? "In" : "Out"}
                        </td>
                        <td className={CELL}>{m.qty}</td>
                        <td className={CELL}>{m.unit}</td>
                        <td className={CELL}>{money(m.rate)}</td>
                        <td className={cn(CELL, m.direction === "in" ? GAIN : LOSS)}>
                          {money(m.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={TOTAL}>
                      <td className={CELL_LEFT} colSpan={7}>
                        Total
                      </td>
                      <td className={cn(CELL, GAIN)}>
                        {money(movementInValue)}
                      </td>
                      <td className={cn(CELL, LOSS)}>
                        {money(movementOutValue)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <Empty>
            No inventory movements recorded in this period.
          </Empty>
        )}
      </Panel>

      <p className="text-[11px] text-muted-foreground">
        Opening stock is valued at the moving weighted average cost of materials and
        the costing sheet of finished goods, as at the day before the period started.
        Closing stock is valued the same way at the end of the period.
      </p>
    </div>
  );
}
