/** Small builders the screens share: names for who a step waits on, and the journey for today. */
import { Journey } from "./journey";
import type { Dataset, IsoDate } from "./types";
import type { Names } from "./workOrders";

export const namesOf = (ds: Dataset): Names => ({
  rep: (c) => ds.reps.find((r) => r.code === c)?.name ?? c,
  pm: (c) => ds.pms.find((r) => r.code === c)?.name ?? c,
  schedulers: ds.staff.schedulers,
  jobSetup: ds.staff.jobSetup,
});

export const journeyOf = (ds: Dataset, today: IsoDate, finalInvoiced: (jobId: string) => boolean = (id) => ds.invoices.some((i) => i.jobId === id && i.kind === "final")) =>
  new Journey(
    ds.stages,
    ds.checkpointDefs,
    ds.jobCheckpoints,
    {
      woFinal: (id) => ds.workOrders.find((w) => w.jobId === id)?.final ?? true,
      hasActuals: (id) => ds.actuals.some((a) => a.jobId === id),
      finalInvoiced,
    },
    today,
    ds.settings.journeySoonDays,
  );
