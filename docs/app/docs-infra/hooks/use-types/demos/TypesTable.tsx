import * as React from 'react';
import { useTypes } from '@mui/internal-docs-infra/useTypes';
import type {
  ProcessedComponentTypeMeta,
  ProcessedHookTypeMeta,
  ProcessedFunctionTypeMeta,
  ProcessedRawTypeMeta,
  ProcessedRawEnumMember,
  ProcessedTypesMeta,
} from '@mui/internal-docs-infra/useTypes';
import { TypesContentProps } from '@mui/internal-docs-infra/abstractCreateTypes';
import styles from './TypesTable.module.css';

export type TypesTableProps = TypesContentProps<{}>;

export function TypesTable(props: TypesTableProps) {
  // Get the main type and additional types for this export
  const { type, additionalTypes } = useTypes(props);

  return (
    <div className={styles.typesTable}>
      {type && <TypeMetaDoc typeMeta={type} />}
      {additionalTypes.map((typeMeta: ProcessedTypesMeta) => (
        <details key={typeMeta.name} className={styles.additionalType}>
          <summary className={styles.additionalTypeSummary}>{typeMeta.name}</summary>
          <div id={typeMeta.slug}>
            <TypeMetaDoc typeMeta={typeMeta} showName={false} />
          </div>
        </details>
      ))}
    </div>
  );
}

function TypeMetaDoc(props: { typeMeta: ProcessedTypesMeta; showName?: boolean }) {
  const { typeMeta, showName = true } = props;

  if (typeMeta.type === 'component') {
    return <ComponentDoc type={typeMeta.data} showName={showName} />;
  }
  if (typeMeta.type === 'hook') {
    return <HookDoc type={typeMeta.data} showName={showName} />;
  }
  if (typeMeta.type === 'function') {
    return <FunctionDoc type={typeMeta.data} showName={showName} />;
  }
  if (typeMeta.type === 'raw') {
    return <RawDoc name={typeMeta.name} data={typeMeta.data} showName={showName} />;
  }
  return null;
}

function ComponentDoc(props: { type: ProcessedComponentTypeMeta; showName?: boolean }) {
  const { type, showName = true } = props;

  return (
    <div className={styles.componentDoc}>
      {showName && <div className={styles.componentName}>{type.name}</div>}
      <div className={styles.componentDescription}>{type.description}</div>
      {Object.keys(type.props).length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Prop</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(type.props).map((key) => {
              const prop = type.props[key];
              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{prop.type}</td>
                  <td>{prop.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {Object.keys(type.dataAttributes).length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Data Attribute</th>
              <th>Description</th>
              <th>Default</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(type.dataAttributes).map((key) => {
              const dataAttr = type.dataAttributes[key];
              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{dataAttr.description}</td>
                  <td>
                    {dataAttr.default !== undefined && (
                      <code>{JSON.stringify(dataAttr.default)}</code>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {Object.keys(type.cssVariables).length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>CSS Variable</th>
              <th>Description</th>
              <th>Default</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(type.cssVariables).map((key) => {
              const cssVar = type.cssVariables[key];
              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{cssVar.description}</td>
                  <td>
                    {cssVar.default !== undefined && <code>{JSON.stringify(cssVar.default)}</code>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function HookDoc(props: { type: ProcessedHookTypeMeta; showName?: boolean }) {
  const { type, showName = true } = props;

  const { name, description, parameters, returnValue } = type;

  return (
    <div className={styles.componentDoc}>
      {showName && <div className={styles.componentName}>{name}</div>}
      {description && <div className={styles.componentDescription}>{description}</div>}
      {Object.keys(parameters).length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(parameters).map((key) => {
              const param = type.parameters[key];
              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{param.type}</td>
                  <td>{param.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className={styles.returnType}>Return Type</div>
      {(() => {
        if (!returnValue) {
          return null;
        }

        // Use discriminated union for type-safe checks
        if (returnValue.kind === 'simple') {
          return (
            <div>
              <div>{returnValue.type}</div>
              {returnValue.description && <div>{returnValue.description}</div>}
            </div>
          );
        }

        // returnValue.kind === 'object'
        return (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Key</th>
                <th>Type</th>
                <th>Required</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(returnValue.properties).map((key) => {
                const prop = returnValue.properties[key];
                return (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{prop.type}</td>
                    <td>{prop.required ? 'Yes' : 'No'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })()}
    </div>
  );
}

function FunctionDoc(props: { type: ProcessedFunctionTypeMeta; showName?: boolean }) {
  const { type, showName = true } = props;

  const { name, description, parameters, returnValue, returnValueDescription } = type;

  return (
    <div className={styles.componentDoc}>
      {showName && <div className={styles.componentName}>{name}</div>}
      {description && <div className={styles.componentDescription}>{description}</div>}
      {Object.keys(parameters).length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(parameters).map((key) => {
              const param = parameters[key];
              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{param.type}</td>
                  <td>{param.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {returnValue && (
        <React.Fragment>
          <div className={styles.returnType}>Return Type</div>
          <div>{returnValue}</div>
          {returnValueDescription && <div>{returnValueDescription}</div>}
        </React.Fragment>
      )}
    </div>
  );
}

function RawDoc(props: { name: string; data: ProcessedRawTypeMeta; showName?: boolean }) {
  const { name, data, showName = true } = props;

  return (
    <div className={styles.componentDoc}>
      {showName && <div className={styles.componentName}>{name}</div>}
      {data.description && <div className={styles.componentDescription}>{data.description}</div>}
      {data.formattedCode && <div className={styles.typeContent}>{data.formattedCode}</div>}
      {data.enumMembers && data.enumMembers.length > 0 && (
        <table className={styles.propsTable}>
          <thead>
            <tr>
              <th>Member</th>
              <th>Value</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {data.enumMembers.map((member: ProcessedRawEnumMember) => (
              <tr key={member.name}>
                <td className={styles.propName}>{member.name}</td>
                <td className={styles.propType}>{member.value}</td>
                <td>{member.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
