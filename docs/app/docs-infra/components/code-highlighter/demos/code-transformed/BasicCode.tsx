import * as React from 'react';
import { Code } from './Code';

const source = `import * as React from 'react';

interface User {
  id: string;
  name: string;
  email: string;
}

interface UserListProps {
  users: User[];
  onSelect: (user: User) => void;
}

export function UserList({ users, onSelect }: UserListProps) {
  const [query, setQuery] = React.useState<string>('');

  const filtered = users.filter((user: User) =>
    user.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <ul>
      {filtered.map((user: User) => (
        <li key={user.id} onClick={() => onSelect(user)}>
          {user.name}
        </li>
      ))}
    </ul>
  );
}`;

export function BasicCode() {
  return (
    // @focus
    <Code fileName="UserList.tsx">{source}</Code>
  );
}
