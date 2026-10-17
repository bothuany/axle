package shop;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.jms.core.JmsTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/orders")
public class OrderController {
	private final KafkaTemplate<String, String> kafkaTemplate;
	private final RabbitTemplate rabbit;
	private final JmsTemplate jms;

	public OrderController(KafkaTemplate<String, String> kafkaTemplate, RabbitTemplate rabbit, JmsTemplate jms) {
		this.kafkaTemplate = kafkaTemplate;
		this.rabbit = rabbit;
		this.jms = jms;
	}

	@PostMapping
	public void place(@RequestBody String order) {
		kafkaTemplate.send("orders", order);
	}

	@PostMapping("/refund")
	public void refund(@RequestBody String order) {
		kafkaTemplate.send(Topics.REFUNDS, order);
	}

	@PostMapping("/ship")
	public void ship(@RequestBody String order) {
		rabbit.convertAndSend("shipping", order);
	}

	@PostMapping("/mail")
	public void mail(@RequestBody String order) {
		jms.convertAndSend("mail.queue", order);
	}

	// A property placeholder names no topic the index can know: no link.
	@PostMapping("/audit")
	public void audit(@RequestBody String order) {
		kafkaTemplate.send("${app.audit-topic}", order);
	}
}
