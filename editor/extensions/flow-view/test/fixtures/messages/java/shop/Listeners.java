package shop;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.jms.annotation.JmsListener;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class Listeners {
	@KafkaListener(topics = "orders", groupId = "billing")
	public void onOrder(String order) {
		charge(order);
	}

	@KafkaListener(topics = Topics.REFUNDS)
	public void onRefund(String order) {
	}

	@RabbitListener(queues = "shipping")
	public void onShip(String order) {
	}

	@JmsListener(destination = "mail.queue")
	public void onMail(String order) {
	}

	@KafkaListener(topics = "${app.audit-topic}")
	public void onAudit(String order) {
	}

	private void charge(String order) {
	}
}
