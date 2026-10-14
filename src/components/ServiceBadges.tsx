import { SERVICE_BADGES } from "@/lib/income";
import type { ServiceKey } from "@/lib/types";

/** Compact "Website · Ads · Automation" chips used in lists and headers. */
export default function ServiceBadges({
  services,
  size = "sm",
}: {
  services: ServiceKey[];
  size?: "sm" | "md";
}) {
  if (!services.length) {
    return <span className="pill">No service</span>;
  }
  return (
    <span className="service-badges">
      {services.map((service) => (
        <span key={service} className={`service-badge service-badge-${service} ${size === "md" ? "service-badge-md" : ""}`}>
          {SERVICE_BADGES[service]}
        </span>
      ))}
    </span>
  );
}
