import { Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import ConsoleLayout from './layouts/ConsoleLayout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Tokens from './pages/Tokens.jsx'
import Logs from './pages/Logs.jsx'
import Models from './pages/Models.jsx'
import Wallet from './pages/Wallet.jsx'
import Docs from './pages/Docs.jsx'
import Channels from './pages/Channels.jsx'
import Users from './pages/Users.jsx'
import Redemptions from './pages/Redemptions.jsx'
import Topups from './pages/Topups.jsx'
import Overview from './pages/Overview.jsx'
import Settings from './pages/Settings.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/console" element={<ConsoleLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="tokens" element={<Tokens />} />
        <Route path="logs" element={<Logs />} />
        <Route path="models" element={<Models />} />
        <Route path="wallet" element={<Wallet />} />
        <Route path="docs" element={<Docs />} />
        <Route path="overview" element={<Overview />} />
        <Route path="channels" element={<Channels />} />
        <Route path="users" element={<Users />} />
        <Route path="redemptions" element={<Redemptions />} />
        <Route path="topups" element={<Topups />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
