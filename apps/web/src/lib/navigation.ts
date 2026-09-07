export type NavigationIcon = "overview" | "experiments" | "compare" | "failures" | "settings";

export type NavigationItem = {
  href: string;
  label: string;
  description: string;
  icon: NavigationIcon;
};

export const navigationItems: readonly NavigationItem[] = [
  {
    href: "/",
    label: "Overview",
    description: "Workspace status and next steps",
    icon: "overview",
  },
  {
    href: "/experiments",
    label: "Experiments",
    description: "Define and inspect evaluation runs",
    icon: "experiments",
  },
  {
    href: "/compare",
    label: "Compare",
    description: "Put two configurations side by side",
    icon: "compare",
  },
  {
    href: "/failures",
    label: "Failures",
    description: "Classify unsuccessful runs",
    icon: "failures",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Workspace display preferences",
    icon: "settings",
  },
];

export function isNavigationItemActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getPageTitle(pathname: string) {
  if (pathname === "/") return "Overview";
  if (pathname.startsWith("/experiments")) return "Experiments";
  if (pathname.startsWith("/tasks")) return "Task detail";
  if (pathname.startsWith("/runs")) return "Run detail";
  if (pathname.startsWith("/compare")) return "Compare";
  if (pathname.startsWith("/failures")) return "Failures";
  if (pathname.startsWith("/settings")) return "Settings";
  return "Workspace";
}

export function getBreadcrumb(pathname: string) {
  const title = getPageTitle(pathname);

  if (pathname === "/") {
    return ["Workspace", title];
  }

  return ["Workspace", title];
}
