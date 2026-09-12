import {
  ADS_STATUS_LABELS,
  AGREEMENT_STATUS_LABELS,
  AUTOMATION_STATUS_LABELS,
  BILLING_STATUS_LABELS,
  WEBSITE_STATUS_LABELS,
} from "@/lib/income";
import type {
  AdsStatus,
  AutomationStatus,
  BillingStatus,
  IncomeAgreementStatus,
  WebsiteStatus,
} from "@/lib/types";

type Tone = "ok" | "warn" | "danger" | "info" | "muted";

const AGREEMENT_TONE: Record<IncomeAgreementStatus, Tone> = {
  active: "ok",
  pending: "info",
  paused: "warn",
  completed: "muted",
  cancelled: "muted",
};

const BILLING_TONE: Record<BillingStatus, Tone> = {
  paid: "ok",
  partial: "warn",
  unpaid: "info",
  overdue: "danger",
};

const WEBSITE_TONE: Record<WebsiteStatus, Tone> = {
  not_started: "muted",
  in_progress: "info",
  review: "info",
  completed: "ok",
  on_hold: "warn",
  cancelled: "muted",
};

const ADS_TONE: Record<AdsStatus, Tone> = {
  not_started: "muted",
  preparation: "info",
  ready: "info",
  live: "ok",
  paused: "warn",
  stopped: "muted",
};

const AUTOMATION_TONE: Record<AutomationStatus, Tone> = {
  not_started: "muted",
  development: "info",
  testing: "info",
  ready: "info",
  live: "ok",
  paused: "warn",
  stopped: "muted",
};

/**
 * One pill for every status in the workspace, so "Overdue" looks the same
 * wherever it appears and no status is ever shown without its meaning.
 */
export default function StatusPill(props:
  | { kind: "agreement"; value: IncomeAgreementStatus; prefix?: string }
  | { kind: "billing"; value: BillingStatus; prefix?: string }
  | { kind: "website"; value: WebsiteStatus; prefix?: string }
  | { kind: "ads"; value: AdsStatus; prefix?: string }
  | { kind: "automation"; value: AutomationStatus; prefix?: string }
) {
  const { label, tone } = resolve(props);
  return (
    <span className={`status-pill status-pill-${tone}`}>
      {props.prefix ? `${props.prefix} ` : ""}
      {label}
    </span>
  );
}

function resolve(props: Parameters<typeof StatusPill>[0]): { label: string; tone: Tone } {
  switch (props.kind) {
    case "agreement":
      return { label: AGREEMENT_STATUS_LABELS[props.value], tone: AGREEMENT_TONE[props.value] };
    case "billing":
      return { label: BILLING_STATUS_LABELS[props.value], tone: BILLING_TONE[props.value] };
    case "website":
      return { label: WEBSITE_STATUS_LABELS[props.value], tone: WEBSITE_TONE[props.value] };
    case "ads":
      return { label: ADS_STATUS_LABELS[props.value], tone: ADS_TONE[props.value] };
    case "automation":
      return {
        label: AUTOMATION_STATUS_LABELS[props.value],
        tone: AUTOMATION_TONE[props.value],
      };
  }
}
