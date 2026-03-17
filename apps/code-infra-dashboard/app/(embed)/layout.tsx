import * as React from 'react';

import './global.css';

const themeScript = `(function(){try{var m=localStorage.getItem("mui-mode");var d=m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches);if(d)document.documentElement.setAttribute("data-dark","")}catch(e){}})()`;

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <React.Fragment>
      {/* Blocking script to set data-dark before first paint, avoiding a flash of wrong theme */}
      {/* eslint-disable-next-line react/no-danger */}
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      {children}
    </React.Fragment>
  );
}
