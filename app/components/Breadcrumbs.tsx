import { Link } from "react-router";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  isActive?: boolean;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav className="flex items-center space-x-1 text-sm text-[var(--muted)] mb-4">
      {items.map((item, index) => (
        <div key={index} className="flex items-center">
          {index > 0 && (
            <span className="mx-2 text-[var(--border)]">/</span>
          )}
          {item.href && !item.isActive ? (
            <Link
              to={item.href}
              className="hover:text-[var(--text)] transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <span className={item.isActive ? "text-[var(--text)] font-medium" : ""}>
              {item.label}
            </span>
          )}
        </div>
      ))}
    </nav>
  );
}