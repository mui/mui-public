import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { parseSourceFactory } from '@mui/internal-docs-infra/parseSource';
import { TsToJsTransformer } from '@mui/internal-docs-infra/transformTsToJs';
import { CodeContent } from '../CodeContent';

export default function PagesRouterDemo() {
  const pagesRouterCode = `// pages/api/users.js
export default function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      // Get users from database
      res.status(200).json({ 
        users: [
          { id: 1, name: 'John Doe', email: 'john@example.com' },
          { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
        ] 
      });
      break;
      
    case 'POST':
      const { name, email } = req.body;
      
      // Validate input
      if (!name || !email) {
        return res.status(400).json({ 
          error: 'Name and email are required' 
        });
      }
      
      // Save to database
      const newUser = {
        id: Date.now(),
        name,
        email,
        createdAt: new Date().toISOString()
      };
      
      res.status(201).json({ user: newUser });
      break;
      
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end(\`Method \${method} Not Allowed\`);
  }
}`;

  const pageComponentCode = `// pages/users.js
import { useState, useEffect } from 'react';
import Head from 'next/head';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/users');
      
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      
      const data = await response.json();
      setUsers(data.users);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addUser = async (name, email) => {
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, email }),
      });

      if (!response.ok) {
        throw new Error('Failed to add user');
      }

      const data = await response.json();
      setUsers(prev => [...prev, data.user]);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <>
      <Head>
        <title>Users - My App</title>
        <meta name="description" content="User management page" />
      </Head>
      
      <main>
        <h1>Users</h1>
        
        <div>
          <h2>Add New User</h2>
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            addUser(
              formData.get('name'),
              formData.get('email')
            );
            e.target.reset();
          }}>
            <input
              name="name"
              placeholder="Name"
              required
            />
            <input
              name="email"
              type="email"
              placeholder="Email"
              required
            />
            <button type="submit">Add User</button>
          </form>
        </div>

        <div>
          <h2>Users List</h2>
          <ul>
            {users.map(user => (
              <li key={user.id}>
                {user.name} - {user.email}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </>
  );
}`;

  return (
    <div>
      <div
        style={{
          padding: '16px',
          marginBottom: '16px',
          backgroundColor: '#e1f5fe',
          borderRadius: '4px',
          border: '1px solid #03a9f4',
        }}
      >
        <h4 style={{ margin: '0 0 8px 0', color: '#0277bd' }}>📄 Pages Router Integration</h4>
        <p style={{ margin: '0', fontSize: '14px', color: '#0277bd' }}>
          This demo shows how to integrate CodeHighlighter with Next.js Pages Router. The examples
          include API routes, page components, and typical patterns used in Pages Router
          applications.
        </p>
      </div>

      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '16px' }}>API Route Example</h3>
        <CodeHighlighter
          url="file://api-users.js"
          code={{
            Default: {
              url: 'file://api-users.js',
              fileName: 'pages/api/users.js',
              source: pagesRouterCode,
            },
          }}
          Content={CodeContent}
          sourceParser={parseSourceFactory()}
          sourceTransformers={[TsToJsTransformer]}
          name="Users API Route"
          description="RESTful API endpoint for user management"
        />
      </div>

      <div>
        <h3 style={{ marginBottom: '16px' }}>Page Component Example</h3>
        <CodeHighlighter
          url="file://users-page.js"
          code={{
            Default: {
              url: 'file://users-page.js',
              fileName: 'pages/users.js',
              source: pageComponentCode,
            },
          }}
          Content={CodeContent}
          sourceParser={parseSourceFactory()}
          sourceTransformers={[TsToJsTransformer]}
          name="Users Page Component"
          description="Complete page component with data fetching and form handling"
        />
      </div>
    </div>
  );
}
