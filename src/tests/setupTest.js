import Enzyme from 'enzyme';
import Adapter from 'enzyme-adapter-react-16';

Enzyme.configure({ adapter: new Adapter() });

process.env.BASE_URL = 'http://example.com';
process.env.LMS_BASE_URL = 'http://auth.example.com';
process.env.LOGIN_URL = 'http://auth.example.com/login';
process.env.LOGIN_URL = 'http://auth.example.com/logout';
process.env.REFRESH_ACCESS_TOKEN_ENDPOINT = 'http://auth.example.com/api/refreshToken';
process.env.ACCESS_TOKEN_COOKIE_NAME = 'access-token-cookie-name';
process.env.USER_INFO_COOKIE_NAME = 'user-info-cookie-name';
process.env.DISABLE_ACCESS_DENIED_LOGOUT = false;
