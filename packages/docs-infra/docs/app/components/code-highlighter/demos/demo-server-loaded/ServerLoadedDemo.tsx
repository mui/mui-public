'use client';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import type {
  LoadCodeMeta,
  LoadSource,
  Code,
} from '@mui/internal-docs-infra/CodeHighlighter/types';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { TypescriptToJavascriptTransformer } from '@mui/internal-docs-infra/pipeline/transformTypescriptToJavascript';
import { DemoContent } from '../DemoContent';

// Mock server-side loading functions
const mockLoadCodeMeta: LoadCodeMeta = async (url: string): Promise<Code> => {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 800));

  // test
  // Mock response based on URL
  if (url.includes('weather-widget')) {
    return {
      Default: {
        url: 'file://weather-widget.tsx',
        fileName: 'WeatherWidget.tsx',
      },
    };
  }

  throw new Error(`Unknown URL: ${url}`);
};

const mockLoadSource: LoadSource = async (url: string) => {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 600));

  if (url.includes('weather-widget')) {
    return {
      source: `import * as React from 'react';

interface WeatherData {
  location: string;
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
}

const mockWeatherData: WeatherData = {
  location: 'New York, NY',
  temperature: 22,
  condition: 'Partly Cloudy',
  humidity: 65,
  windSpeed: 12,
};

function WeatherWidget() {
  const [weather, setWeather] = React.useState<WeatherData | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    // Simulate API call
    const timer = setTimeout(() => {
      setWeather(mockWeatherData);
      setLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="weather-widget loading">
        <div className="loading-spinner" />
        <p>Loading weather data...</p>
      </div>
    );
  }

  if (!weather) {
    return (
      <div className="weather-widget error">
        <p>Failed to load weather data</p>
      </div>
    );
  }

  return (
    <div className="weather-widget">
      <div className="location">
        <h3>{weather.location}</h3>
      </div>
      <div className="temperature">
        <span className="temp">{weather.temperature}°C</span>
        <span className="condition">{weather.condition}</span>
      </div>
      <div className="details">
        <div className="detail">
          <label>Humidity:</label>
          <span>{weather.humidity}%</span>
        </div>
        <div className="detail">
          <label>Wind Speed:</label>
          <span>{weather.windSpeed} km/h</span>
        </div>
      </div>
    </div>
  );
}

export default WeatherWidget;`,
      extraFiles: {
        'styles.css': `/* Weather Widget Styles */
.weather-widget {
  max-width: 300px;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  background: linear-gradient(135deg, #74b9ff 0%, #0984e3 100%);
  color: white;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', roboto, sans-serif;
}

.weather-widget.loading {
  text-align: center;
  background: #f5f5f5;
  color: #666;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #e0e0e0;
  border-top: 3px solid #666;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.location h3 {
  margin: 0 0 16px 0;
  font-size: 18px;
  font-weight: 600;
}

.temperature {
  text-align: center;
  margin-bottom: 20px;
}

.temp {
  display: block;
  font-size: 48px;
  font-weight: 300;
  line-height: 1;
}

.condition {
  font-size: 14px;
  opacity: 0.9;
}

.details {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.detail {
  text-align: center;
  flex: 1;
}

.detail label {
  display: block;
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 4px;
}

.detail span {
  font-size: 16px;
  font-weight: 500;
}`,
      },
    };
  }

  throw new Error(`Unknown source URL: ${url}`);
};

// Weather widget component for preview
function WeatherWidget() {
  const [weather, setWeather] = React.useState<{
    location: string;
    temperature: number;
    condition: string;
    humidity: number;
    windSpeed: number;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setWeather({
        location: 'New York, NY',
        temperature: 22,
        condition: 'Partly Cloudy',
        humidity: 65,
        windSpeed: 12,
      });
      setLoading(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div
        style={{
          maxWidth: '300px',
          padding: '20px',
          textAlign: 'center',
          border: '1px solid #e0e0e0',
          borderRadius: '12px',
          background: '#f5f5f5',
        }}
      >
        <div
          style={{
            width: '24px',
            height: '24px',
            border: '3px solid #e0e0e0',
            borderTop: '3px solid #666',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 12px',
          }}
        />
        <p>Loading weather data...</p>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: '300px',
        padding: '20px',
        border: '1px solid #e0e0e0',
        borderRadius: '12px',
        background: 'linear-gradient(135deg, #74b9ff 0%, #0984e3 100%)',
        color: 'white',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", roboto, sans-serif',
      }}
    >
      <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>{weather?.location}</h3>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <span style={{ display: 'block', fontSize: '48px', fontWeight: '300' }}>
          {weather?.temperature}°C
        </span>
        <span style={{ fontSize: '14px', opacity: 0.9 }}>{weather?.condition}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '4px' }}>Humidity</div>
          <span style={{ fontSize: '16px', fontWeight: '500' }}>{weather?.humidity}%</span>
        </div>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '4px' }}>Wind Speed</div>
          <span style={{ fontSize: '16px', fontWeight: '500' }}>{weather?.windSpeed} km/h</span>
        </div>
      </div>
    </div>
  );
}

export default function ServerLoadedDemo() {
  return (
    <div>
      <div
        style={{
          padding: '16px',
          marginBottom: '16px',
          backgroundColor: '#fff3e0',
          borderRadius: '4px',
          border: '1px solid #ff9800',
        }}
      >
        <h4 style={{ margin: '0 0 8px 0', color: '#e65100' }}>🔄 Dynamic Server Loading</h4>
        <p style={{ margin: '0', fontSize: '14px', color: '#e65100' }}>
          This demo shows how CodeHighlighter can load code and components from server-side sources.
          The code content and extra files are fetched asynchronously when needed.
        </p>
      </div>

      <CodeHighlighter
        url="https://api.example.com/components/weather-widget"
        components={{ Default: <WeatherWidget /> }}
        Content={DemoContent}
        loadCodeMeta={mockLoadCodeMeta}
        loadSource={mockLoadSource}
        sourceParser={createParseSource()}
        sourceTransformers={[TypescriptToJavascriptTransformer]}
        name="Weather Widget"
      />
    </div>
  );
}
