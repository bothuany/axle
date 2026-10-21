package com.harborgoods.shipping;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class OrderEvents {
    private final ShipmentService shipments;

    public OrderEvents(ShipmentService shipments) {
        this.shipments = shipments;
    }

    @KafkaListener(topics = "order.placed", groupId = "shipping")
    public void onOrderPlaced(String order) {
        boolean discounted = order.contains("discountCode=") && !order.contains("discountCode=null");
        shipments.schedule(order, discounted);
    }
}
