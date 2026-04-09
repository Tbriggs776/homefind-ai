import AdminDashboard from './pages/AdminDashboard';
import Home from './pages/Home';
import IdxBrokerSetup from './pages/IdxBrokerSetup';
import Login from './pages/Login';
import ManageUsers from './pages/ManageUsers';
import MarketPulse from './pages/MarketPulse';
import Profile from './pages/Profile';
import PropertyCompare from './pages/PropertyCompare';
import PropertyDetail from './pages/PropertyDetail';
import SavedProperties from './pages/SavedProperties';
import Search from './pages/Search';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AdminDashboard": AdminDashboard,
    "Home": Home,
    "IdxBrokerSetup": IdxBrokerSetup,
    "Login": Login,
    "ManageUsers": ManageUsers,
    "MarketPulse": MarketPulse,
    "Profile": Profile,
    "PropertyCompare": PropertyCompare,
    "PropertyDetail": PropertyDetail,
    "SavedProperties": SavedProperties,
    "Search": Search,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};
