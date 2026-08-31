import {
  ListChecks,
  CheckCircle2,
  Circle,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

type StatCardProps = {
  title: string;
  value: number;
};

export default function StatCard({
  title,
  value,
}: StatCardProps) {
  // ----------------------------------
  // CARD STYLE BASED ON STAT TYPE
  // ----------------------------------
  //
  // Icons are real Lucide components (same icon set as VoiceControl/
  // AITextControl/TaskCard use throughout the rest of the dashboard)
  // rather than plain text glyphs (✓ ○ ! •) — those rendered
  // inconsistently across fonts/platforms and were the one part of
  // the dashboard using a different "icon system" than everywhere
  // else. Also fixes Total previously reusing the same checkmark as
  // Completed, which doesn't mean "done" for a raw count.

  const getCardDetails = (): {
    icon: LucideIcon;
    iconStyle: string;
    cardAccent: string;
    description: string;
  } => {
    switch (title.toLowerCase()) {
      // ----------------------------------
      // TOTAL
      // ----------------------------------

      case "total tasks":
      case "total":
        return {
          icon: ListChecks,
          iconStyle:
            "bg-primary/30 text-primary",
          cardAccent: "border-primary/30",
          description: "All your tasks",
        };

      // ----------------------------------
      // COMPLETED
      // ----------------------------------

      case "completed":
      case "completed tasks":
        return {
          icon: CheckCircle2,
          iconStyle:
            "bg-success/35 text-success",
          cardAccent: "border-success/40",
          description: "Tasks finished",
        };

      // ----------------------------------
      // PENDING
      // ----------------------------------

      case "pending":
      case "pending tasks":
        return {
          icon: Circle,
          iconStyle:
            "bg-info/35 text-info",
          cardAccent: "border-info/40",
          description: "Still to complete",
        };

      // ----------------------------------
      // OVERDUE
      // ----------------------------------

      case "overdue":
      case "overdue tasks":
        return {
          icon: AlertTriangle,
          iconStyle:
            "bg-warning/35 text-warning",
          cardAccent: "border-warning/40",
          description: "Past their due date",
        };

      // ----------------------------------
      // HIGH PRIORITY
      // ----------------------------------

      case "high priority":
      case "high priority tasks":
        return {
          icon: AlertTriangle,
          iconStyle:
            "bg-warning/35 text-warning",
          cardAccent: "border-warning/40",
          description: "Needs attention",
        };

      // ----------------------------------
      // DEFAULT
      // ----------------------------------

      default:
        return {
          icon: ListChecks,
          iconStyle:
            "bg-primary-light text-charcoal",
          cardAccent: "border-gray-200",
          description: "Task overview",
        };
    }
  };

  const details = getCardDetails();
  const Icon = details.icon;

  return (
    <div
      className={`group h-full rounded-2xl border bg-white p-4 shadow-sm transition duration-200 hover:shadow-md sm:p-5 sm:hover:-translate-y-0.5 ${details.cardAccent}`}
    >

      {/* ==================================
          TOP
      ================================== */}

      <div className="flex items-start justify-between gap-3 sm:gap-4">

        {/* ----------------------------------
            INFORMATION
        ---------------------------------- */}

        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-gray sm:text-sm">
            {title}
          </p>

          <p className="mt-1.5 text-2xl font-bold tracking-tight text-charcoal sm:mt-2 sm:text-3xl">
            {value}
          </p>
        </div>

        {/* ----------------------------------
            ICON
        ---------------------------------- */}

        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${details.iconStyle}`}
          aria-hidden="true"
        >
          <Icon size={18} strokeWidth={2} className="sm:h-5 sm:w-5" />
        </div>

      </div>

      {/* ==================================
          DESCRIPTION
      ================================== */}

      <p className="mt-3 text-[11px] font-medium text-muted-gray sm:mt-4 sm:text-xs">
        {details.description}
      </p>

    </div>
  );
}