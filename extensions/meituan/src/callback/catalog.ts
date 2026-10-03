/** SDK 消息目录与 cloud-meituan 已配置的服务零售消息交集/补充。
 * 仅收录异步通知和消息；同步查询、设备命令、OAuth 不作为事件 ACK。
 */
export type MeituanNotificationKind = "notification" | "message";
export type MeituanNotificationType = {
  businessId: string;
  msgType: string;
  name: string;
  kind: MeituanNotificationKind;
};

const rows: ReadonlyArray<readonly [string, string, string, MeituanNotificationKind?]> = [
  ["2", "210069", "two_party_im_message", "message"],
  ["15", "15201", "membership_card_event"], ["15", "15202", "membership_card_points"],
  ["27", "27001", "create_result_notice"], ["27", "27002", "stock_in_notice"],
  ["27", "27003", "stock_out_notice"], ["27", "27004", "order_cancel_notice"],
  ["27", "2710003", "bill_detail_notice"], ["27", "2710005", "order_shipment_notice"],
  ["46", "4610000", "package_delivery_accepted"], ["46", "4610023", "poi_info_changed"],
  ["46", "4610018", "order_completed"], ["46", "4610016", "self_delivery_completed"],
  ["46", "4610014", "self_delivery_available"], ["46", "4610012", "delivery_status_changed"],
  ["46", "4610010", "meal_ready"], ["46", "4610008", "refund_status_changed"],
  ["46", "4610006", "order_timeout_canceled"], ["46", "4610004", "order_rejected"],
  ["46", "4610002", "order_paid"], ["46", "4610026", "self_delivery_transfer_succeeded"],
  ["46", "4610024", "preorder_meal_reminder"],
  ["51", "5110001", "online_business_change"], ["51", "5110003", "online_service_status_change"],
  ["51", "5110007", "product_audit_notice"], ["51", "5110011", "platform_order_status_change"],
  ["51", "5110013", "order_push"], ["51", "5110023", "refund_application_push"],
  ["51", "5110025", "paid_order_push"],
  ["55", "5510001", "activity_change_notice"],
  ["58", "5810001", "booking_cancel"], ["58", "5810015", "booking_modify_submit"],
  ["58", "5810031", "booking_verify_sync"], ["58", "5810055", "verify_order_info_push"],
  ["58", "5810099", "booking_final_order_verify_notice"],
  ["58", "5810173", "order_refund_info_pushed"],
  ["59", "5910003", "product_status_changed"],
  ["59", "5910025", "merchant_coupon_consumed_refund_notice"],
  ["59", "5910027", "merchant_coupon_forced_refund_notice"],
  ["59", "5910029", "merchant_coupon_refund"], ["59", "5910031", "merchant_coupon_issue"],
  ["59", "5910019", "member_created"], ["59", "5910013", "reservation_cancel_result_sync"],
  ["59", "5910017", "reservation_user_modified"],
  ["59", "5910005", "reservation_modify_result_sync"],
  ["59", "5910009", "fulfillment_status_changed"],
  ["59", "5910049", "product_online_status_changed"],
  ["59", "5910081", "payment_result_notified"], ["59", "5910083", "refund_result_notified"],
  ["59", "5910101", "club_activity_audit_result"],
  ["59", "5910099", "mall_member_points_authorized"],
  ["59", "5910093", "mall_points_transaction_pushed"],
  ["59", "5910109", "deal_group_published"],
  ["59", "5910135", "reservation_operation_result_sync"],
  ["59", "5910139", "merchant_coupon_degraded"],
  ["59", "5910147", "deal_group_room_relation_result"],
  ["59", "5910137", "group_buy_product_changed"],
  ["59", "5910141", "show_event_status_updated"],
  ["59", "5910149", "member_unregistered"],
  ["71", "7110001", "poi_openapi_msg_push"],
];

export const MEITUAN_NOTIFICATION_TYPES: ReadonlyArray<MeituanNotificationType> = rows.map(
  ([businessId, msgType, name, kind]) => ({ businessId, msgType, name, kind: kind ?? "notification" }),
);
const byKey = new Map(MEITUAN_NOTIFICATION_TYPES.map((item) => [`${item.businessId}:${item.msgType}`, item]));

/** 未列入目录的类型不得进入异步通知处理链。 */
export function resolveMeituanNotificationType(
  businessId: string,
  msgType: string,
): MeituanNotificationType | undefined {
  return byKey.get(`${businessId}:${msgType}`);
}
