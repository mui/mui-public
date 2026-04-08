import * as React from 'react';
import './ExpandingBox.css';

export function ExpandingBox({
  isActive,
  isCollapsed,
  className,
  children,
}: {
  isActive?: boolean;
  isCollapsed?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <React.Fragment>
      <span
        className="expanding-box-head"
        data-active={Boolean(isActive)}
        data-collapsed={Boolean(isCollapsed)}
      >
        <span />
        <span />
        <span />
      </span>
      <span
        className="expanding-box-content"
        data-active={Boolean(isActive)}
        data-collapsed={Boolean(isCollapsed)}
      >
        <span />
        <span className={className}>
          {children}
          <span className="expanding-box-extra" />
        </span>
      </span>
      <span
        className="expanding-box-foot"
        data-active={Boolean(isActive)}
        data-collapsed={Boolean(isCollapsed)}
      >
        <span />
        <span />
        <span />
      </span>
    </React.Fragment>
  );
}
