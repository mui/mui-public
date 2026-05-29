import * as React from 'react';
import './ExpandingBox.css';

export function ExpandingBox({
  isActive,
  isCollapsed,
  className,
  as: Element = 'div',
  children,
}: {
  isActive?: boolean;
  isCollapsed?: boolean;
  className?: string;
  /**
   * Element to render the shell wrappers as. Defaults to `'div'`
   * since a "Box" naturally wraps flow content. Pass `'span'` when
   * the box is nested inside a phrasing-only container (e.g. inside
   * a `<button>`) so the markup stays valid.
   */
  as?: 'div' | 'span';
  children: React.ReactNode;
}) {
  return (
    <React.Fragment>
      <Element
        className="expanding-box-head"
        data-active={Boolean(isActive)}
        data-collapsed={Boolean(isCollapsed)}
      >
        <Element />
        <Element />
        <Element />
      </Element>
      <Element
        className="expanding-box-content"
        data-active={Boolean(isActive)}
        data-collapsed={Boolean(isCollapsed)}
      >
        <Element />
        <Element className={className}>
          {children}
          <Element className="expanding-box-extra" />
        </Element>
      </Element>
      <Element
        className="expanding-box-foot"
        data-active={Boolean(isActive)}
        data-collapsed={Boolean(isCollapsed)}
      >
        <Element />
        <Element />
        <Element />
      </Element>
    </React.Fragment>
  );
}
