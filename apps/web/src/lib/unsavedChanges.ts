/** Thuần — chỉ chặn khi ĐỔI TRANG (pathname); đổi query/hash trong cùng trang không làm mất form. */
export function shouldBlockNavigation(args: {
  currentLocation: { pathname: string };
  nextLocation: { pathname: string };
}): boolean {
  return args.currentLocation.pathname !== args.nextLocation.pathname;
}
