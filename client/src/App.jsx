import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <header>
          <h1>Father's Advice</h1>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<h2>Welcome</h2>} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
